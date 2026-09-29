import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, type App } from '../src/app.js';
import { buildServer } from '../src/http-server.js';
import { loadConfig, type AppConfig } from '../src/config.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/** Start de API in het geheugen, met een stub voor uitgaande verzoeken. */
async function startApp(
  options: { env?: Record<string, string>; routes?: Record<string, unknown> } = {},
): Promise<{ server: FastifyInstance; app: App }> {
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;

  const config: AppConfig = loadConfig();
  const fetchImpl = (async (url: string | URL | Request) => {
    const key = String(url);
    for (const [pattern, value] of Object.entries(options.routes ?? {})) {
      if (key.includes(pattern)) {
        // Routes mogen een belofte teruggeven; een vertraging maakt een
        // overlappende sync mogelijk, zoals in productie met een trage bron.
        const result = await Promise.resolve(typeof value === 'function' ? value() : value);
        return new Response(JSON.stringify(result), { status: 200 });
      }
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  const app = createApp({ config, databaseFile: ':memory:', fetchImpl });
  // Dezelfde server als het echte proces, zodat de tests niet iets anders
  // toetsen dan wat er daadwerkelijk draait.
  const server = await buildServer(app, { logger: false });
  await server.ready();

  cleanups.push(async () => {
    await server.close();
    app.close();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });

  return { server, app };
}

const LIDL = {
  SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl',
  SOURCE_LIDL_API_KEY: 'TOPGEHEIM-TOKEN',
};

describe('statusroutes', () => {
  it('antwoordt op /health', async () => {
    const { server } = await startApp();
    const response = await server.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('toont bij /sources alle vier de winkels met een uitleg', async () => {
    const { server } = await startApp();
    const body = (await server.inject({ method: 'GET', url: '/api/sources' })).json();

    expect(body.sources).toHaveLength(4);
    expect(body.sources.map((s: { storeId: string }) => s.storeId)).toEqual(['lidl', 'albert_heijn', 'dirk', 'kruidvat']);
    expect(body.sources.every((s: { status: string }) => s.status === 'not_configured')).toBe(true);
    expect(body.hasLivePricing).toBe(false);
    expect(body.sources[0].message).toMatch(/niets verzonnen|geen prijzen|niet verzonnen/i);
  });

  it('leakt via /config geen enkele sleutel of endpoint', async () => {
    const { server } = await startApp({ env: LIDL });
    const response = await server.inject({ method: 'GET', url: '/api/config' });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('TOPGEHEIM-TOKEN');
    expect(response.body).not.toContain('bron.example');
    const body = response.json();
    const lidl = body.sources.find((s: { storeId: string }) => s.storeId === 'lidl');
    expect(lidl.configured).toBe(true);
  });

  it('start de sync op de achtergrond en antwoordt meteen', async () => {
    const { server } = await startApp();
    const response = await server.inject({ method: 'POST', url: '/api/sources/sync', payload: {} });
    const body = response.json();

    // 202, niet 200: het werk is nog niet klaar. Een volledige run duurt
    // ruim twee minuten en zou hier anders tegen de time-out van de host
    // aanlopen.
    expect(response.statusCode).toBe(202);
    expect(body.started).toBe(true);
    expect(body.stores).toHaveLength(4);
    expect(body.message).toMatch(/bezig/i);
  });

  it('weigert een tweede sync terwijl de eerste loopt', async () => {
    // De bron wordt bewust traag gemaakt: pas dan overlappen de runs elkaar,
    // zoals bij een echte sync die minuten duurt.
    const { server, app } = await startApp({
      env: LIDL,
      // Eén patroon dat álle bronverzoeken raakt; elke aanvraag duurt 300 ms,
      // zodat de sync nog loopt als de tweede click komt.
      routes: { 'bron.example': () => new Promise((resolve) => setTimeout(() => resolve({ offers: [] }), 300)) },
    });

    const first = await server.inject({ method: 'POST', url: '/api/sources/sync', payload: {} });
    expect(first.statusCode).toBe(202);

    const second = await server.inject({ method: 'POST', url: '/api/sources/sync', payload: {} });
    // Twee runs tegelijk zouden op dezelfde rijen schrijven.
    expect(second.statusCode).toBe(409);
    expect(second.json().message).toMatch(/loopt al/i);

    await app.sync.waitForBackgroundSync();
  });

  it('laat tijdens de sync zien dat er gewerkt wordt', async () => {
    const { server, app } = await startApp({
      env: LIDL,
      routes: {
        'bron.example': () => new Promise((resolve) => setTimeout(() => resolve({ offers: [] }), 300)),
      },
    });
    await server.inject({ method: 'POST', url: '/api/sources/sync', payload: {} });

    const tijdens = await server.inject({ method: 'GET', url: '/api/sources' });
    const statussen = tijdens.json().sources as Array<{ status: string }>;
    // Zonder dit zou de interface de vorige prijzen blijven tonen als "vers".
    expect(statussen.filter((status) => status.status === 'syncing').length).toBeGreaterThan(0);

    await app.sync.waitForBackgroundSync();
  });

  it('weigert een onbekende winkel', async () => {
    const { server } = await startApp();
    const response = await server.inject({
      method: 'POST',
      url: '/api/sources/sync',
      payload: { storeId: 'aldi' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/lidl/);
  });
});

describe('winkels en aanbiedingen', () => {
  it('toont de vier winkels met klantenkaart', async () => {
    const { server } = await startApp();
    const body = (await server.inject({ method: 'GET', url: '/api/stores' })).json();

    expect(body.stores).toHaveLength(4);
    expect(body.stores.find((s: { id: string }) => s.id === 'albert_heijn').loyaltyCardName).toBe('AH Bonuskaart');
  });

  it('geeft een lege aanbiedingenlijst mét uitleg zonder bron', async () => {
    const { server } = await startApp();
    const body = (await server.inject({ method: 'GET', url: '/api/offers' })).json();

    expect(body.offers).toEqual([]);
    expect(body.hasLivePricing).toBe(false);
  });

  it('laat aanbiedingen van elke winkel zien, ook als andere winkels er meer hebben', async () => {
    // Terugkerende fout: eerst de limiet (100) in de database pakken en daarna
    // in het geheugen op winkel filteren gaf de eerste 100 rijen terug. Lidl
    // heeft hier 150 aanbiedingen, Dirk 2 — zo vult Lidl de hele limiet en
    // zou Dirk leeg lijken.
    const veelAanbiedingen = (store: string, aantal: number) =>
      Array.from({ length: aantal }, (_, i) => ({
        id: `${store}-${i}`,
        title: `${store} product ${i}`,
        offerPrice: 1.0 + i / 100,
        regularPrice: 2.5,
        kind: 'price_drop',
      }));

    const { server, app } = await startApp({
      env: { ...LIDL, SOURCE_DIRK_BASE_URL: 'https://bron.example/dirk', SOURCE_DIRK_API_KEY: 'x' },
      routes: {
        'lidl/offers': { offers: veelAanbiedingen('lidl', 150) },
        'dirk/offers': { offers: veelAanbiedingen('dirk', 2) },
        'lidl/prices': { prices: [] },
        'dirk/prices': { prices: [] },
      },
    });

    await server.inject({ method: 'POST', url: '/api/sources/sync', payload: {} });
    await app.sync.waitForBackgroundSync();

    const dirk = (await server.inject({ method: 'GET', url: '/api/offers?storeId=dirk' })).json();
    expect(dirk.count, 'Dirk heeft 2 aanbiedingen, ondanks 150 van Lidl ervoor').toBe(2);
    expect(dirk.offers.every((o: { storeId: string }) => o.storeId === 'dirk')).toBe(true);

    const lidl = (await server.inject({ method: 'GET', url: '/api/offers?storeId=lidl' })).json();
    expect(lidl.count, 'Lidl toont de limiet van 100').toBe(100);
  });

  it('laat aanbiedingen uit een gekoppelde bron zien', async () => {
    const { server, app } = await startApp({
      env: LIDL,
      routes: {
        '/offers': { offers: [{ id: 'a1', title: 'Coca-Cola 1,5 l', offerPrice: 2.25, regularPrice: 2.79, kind: 'price_drop' }] },
        '/prices': { prices: [] },
      },
    });

    await server.inject({ method: 'POST', url: '/api/sources/sync', payload: { storeId: 'lidl' } });
    // De sync loopt op de achtergrond; zonder hier te wachten zou de lijst
    // nog leeg zijn.
    await app.sync.waitForBackgroundSync();
    const body = (await server.inject({ method: 'GET', url: '/api/offers?storeId=lidl' })).json();

    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].offerPriceCents).toBe(225);
    expect(body.offers[0].sourceConfigured).toBe(true);
    // Ook in de aanbiedingen staat geen spoor van de sleutel.
    expect(JSON.stringify(body)).not.toContain('TOPGEHEIM-TOKEN');
  });
});

describe('boodschappenlijsten', () => {
  it('maakt een lijst aan, voegt regels toe en haalt ze op', async () => {
    const { server } = await startApp();

    const created = await server.inject({ method: 'POST', url: '/api/lists', payload: { name: 'Week 1' } });
    expect(created.statusCode).toBe(201);
    const listId = created.json().list.id;

    const added = await server.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items`,
      payload: { name: 'Melk', amount: 2, unit: 'l' },
    });
    expect(added.statusCode).toBe(201);

    const detail = (await server.inject({ method: 'GET', url: `/api/lists/${listId}` })).json();
    expect(detail.list.name).toBe('Week 1');
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].name).toBe('Melk');
  });

  it('geeft 404 voor een onbekende lijst', async () => {
    const { server } = await startApp();
    const response = await server.inject({ method: 'GET', url: '/api/lists/bestaat-niet' });
    expect(response.statusCode).toBe(404);
  });

  it('vinkt een regel af en verwijdert hem', async () => {
    const { server } = await startApp();
    const listId = (await server.inject({ method: 'POST', url: '/api/lists', payload: {} })).json().list.id;
    const itemId = (await server.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items`,
      payload: { name: 'Bananen' },
    })).json().item.id;

    const patched = await server.inject({ method: 'PATCH', url: `/api/items/${itemId}`, payload: { checked: true } });
    expect(patched.json().item.checked).toBe(true);

    expect((await server.inject({ method: 'DELETE', url: `/api/items/${itemId}` })).statusCode).toBe(204);
    expect((await server.inject({ method: 'GET', url: `/api/lists/${listId}` })).json().items).toHaveLength(0);
  });
});

describe('parser', () => {
  it('leest meerdere regels met hoeveelheden', async () => {
    const { server } = await startApp();
    const response = await server.inject({
      method: 'POST',
      url: '/api/parse',
      payload: { text: '2 melk\n1,5 l cola zero\n3 pakken yoghurt' },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.items).toHaveLength(3);
    expect(body.items[0].quantity.amount).toBe(2);
    expect(body.message).toMatch(/controleer/i);
  });

  it('vraagt om bevestiging zolang er twijfel is', async () => {
    const { server } = await startApp();
    const body = (await server.inject({
      method: 'POST',
      url: '/api/parse',
      payload: { text: '2 melk' },
    })).json();

    // Zonder producten in de database is er niets om aan te koppelen.
    expect(body.items[0].needsConfirmation).toBe(true);
    expect(body.items[0].suggestedProductId).toBeNull();
  });

  it('zet bevestigde regels op de lijst', async () => {
    const { server } = await startApp();
    const listId = (await server.inject({ method: 'POST', url: '/api/lists', payload: {} })).json().list.id;

    const response = await server.inject({
      method: 'POST',
      url: `/api/lists/${listId}/import`,
      payload: { items: [{ name: 'Melk', amount: 2, unit: 'l' }, { name: 'Brot' }] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().added).toBe(2);
  });
});

describe('producten bevestigen en eigen namen', () => {
  /** Zet een product in de database, net zoals een synchronisatie dat doet. */
  function seedProduct(app: App, name: string): string {
    return app.sync.products.resolve({
      name,
      storeId: 'lidl',
      storeProductId: `test-${name}`,
    }).productId;
  }

  it('bevestigt een product zonder body', async () => {
    const { server, app } = await startApp();
    const id = seedProduct(app, 'Coca-Cola regular 1,5 l');

    // Een bevestiging heeft geen inhoud; dat mag geen 400 zijn.
    const response = await server.inject({ method: 'POST', url: `/api/products/${id}/confirm` });
    expect(response.statusCode).toBe(200);

    const products = (await server.inject({ method: 'GET', url: '/api/products' })).json();
    expect(products.products.find((p: { id: string }) => p.id === id)?.verified).toBe(true);
  });

  it('gebruikt een eigen naam daarna overal', async () => {
    const { server, app } = await startApp();
    const id = seedProduct(app, 'Coca-Cola regular 1,5 l');

    const alias = await server.inject({
      method: 'POST',
      url: `/api/products/${id}/alias`,
      payload: { alias: 'cola' },
    });
    expect(alias.statusCode).toBe(200);

    // Zonder de eigen naam zou "cola" op niets uitkomen: de winkelnaam is langer.
    const body = (await server.inject({ method: 'POST', url: '/api/parse', payload: { text: '1,5 l cola' } })).json();
    expect(body.items[0].suggestedProductId).toBe(id);
    expect(body.items[0].needsConfirmation).toBe(false);
  });
});

describe('optimalisatie zonder prijzen', () => {
  it('zegt eerlijk dat er geen prijzen zijn', async () => {
    const { server } = await startApp();
    const listId = (await server.inject({ method: 'POST', url: '/api/lists', payload: {} })).json().list.id;
    await server.inject({ method: 'POST', url: `/api/lists/${listId}/items`, payload: { name: 'Melk' } });

    const body = (await server.inject({ method: 'GET', url: `/api/lists/${listId}/optimize` })).json();
    expect(body.hasCompletePricing).toBe(false);
    expect(body.message).toMatch(/geen prijzen|Importeren/i);
  });
});

describe('winkelkeuze bij optimaliseren', () => {
  /** Twee winkels, elk met een eigen prijs voor hetzelfde product. */
  async function startWithTwoStores() {
    const started = await startApp({
      env: {
        SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl',
        SOURCE_LIDL_API_KEY: 'TOPGEHEIM-TOKEN',
        SOURCE_DIRK_BASE_URL: 'https://bron.example/dirk',
        SOURCE_DIRK_API_KEY: 'TOPGEHEIM-TOKEN',
      },
      routes: {
        'bron.example/lidl/offers': {
          offers: [{ id: 'l1', title: 'Melk', offerPrice: 1.29, regularPrice: 1.49, kind: 'price_drop' }],
        },
        'bron.example/dirk/offers': {
          offers: [{ id: 'd1', title: 'Melk', offerPrice: 0.99, regularPrice: 1.29, kind: 'price_drop' }],
        },
      },
    });

    await started.server.inject({ method: 'POST', url: '/api/sources/sync', payload: { storeId: 'lidl' } });
    await started.server.inject({ method: 'POST', url: '/api/sources/sync', payload: { storeId: 'dirk' } });

    const listId = (
      await started.server.inject({ method: 'POST', url: '/api/lists', payload: {} })
    ).json().list.id;
    await started.server.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items`,
      payload: { name: 'Melk', amount: 1, unit: 'st' },
    });

    return { ...started, listId };
  }

  it('rekent met alle winkels als er geen filter is', async () => {
    const { server, listId } = await startWithTwoStores();
    const body = (await server.inject({ method: 'GET', url: `/api/lists/${listId}/optimize` })).json();

    // Beide winkels leveren een prijs voor melk; Dirk is met 0,99 goedkoper.
    expect(body.perStore.map((plan: { storeIds: string[] }) => plan.storeIds[0])).toEqual(['dirk', 'lidl']);
    expect(body.cheapestSingleStore.storeIds).toEqual(['dirk']);
    expect(body.cheapestTotal).toBeCloseTo(0.99, 5);
  });

  it('beperkt de berekening tot de gekozen winkels', async () => {
    const { server, listId } = await startWithTwoStores();
    const body = (
      await server.inject({ method: 'GET', url: `/api/lists/${listId}/optimize?stores=lidl` })
    ).json();

    // Dirk is buiten beschouwing gelaten: alleen Lidl telt mee.
    expect(body.perStore.map((plan: { storeIds: string[] }) => plan.storeIds[0])).toEqual(['lidl']);
    expect(body.cheapestSingleStore.storeIds).toEqual(['lidl']);
    expect(body.cheapestTotal).toBeCloseTo(1.29, 5);
  });

  it('negeert onbekende winkels in de filter', async () => {
    const { server, listId } = await startWithTwoStores();
    const body = (
      await server.inject({ method: 'GET', url: `/api/lists/${listId}/optimize?stores=lidl,fantasiewinkel` })
    ).json();

    expect(body.perStore.map((plan: { storeIds: string[] }) => plan.storeIds[0])).toEqual(['lidl']);
    expect(body.cheapestTotal).toBeCloseTo(1.29, 5);
  });
});

describe('voorraadkast en menu', () => {
  it('voegt voorraad toe en telt op bij herhaling', async () => {
    const { server } = await startApp();
    await server.inject({ method: 'POST', url: '/api/pantry', payload: { name: 'Melk', amount: 1, unit: 'l' } });
    await server.inject({ method: 'POST', url: '/api/pantry', payload: { name: 'melk', amount: 1, unit: 'l' } });

    const body = (await server.inject({ method: 'GET', url: '/api/pantry' })).json();
    expect(body.items).toHaveLength(1);
    // Hoeveelheden worden in basiseenheden bewaard: 2 liter is 2000 ml.
    expect(body.items[0].amount).toBe(2000);
    expect(body.items[0].unit).toBe('ml');
  });

  it('voegt een gerecht met ingrediënten toe en laat zien wat nodig is', async () => {
    const { server } = await startApp();
    const response = await server.inject({
      method: 'POST',
      url: '/api/menu/meals',
      payload: {
        day: 'maandag',
        name: 'Pasta',
        ingredients: [
          { name: 'Pasta', amount: 500, unit: 'g' },
          { name: 'Tomaten', amount: 2, unit: 'st' },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.menu.meals).toHaveLength(1);
    expect(body.menu.shopping).toHaveLength(2);
  });

  it('weigert een onbekende dag', async () => {
    const { server } = await startApp();
    const response = await server.inject({
      method: 'POST',
      url: '/api/menu/meals',
      payload: { day: 'dinsdagavond', name: 'Soep' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('voegt dezelfde ingrediënten over dagen heen samen', async () => {
    const { server } = await startApp();
    for (const day of ['maandag', 'dinsdag']) {
      await server.inject({
        method: 'POST',
        url: '/api/menu/meals',
        payload: { day, name: `Gerecht ${day}`, ingredients: [{ name: 'Ui', amount: 1, unit: 'st' }] },
      });
    }

    const body = (await server.inject({ method: 'GET', url: '/api/menu' })).json();
    const ui = body.menu.shopping.find((item: { name: string }) => item.name.toLowerCase() === 'ui');
    expect(ui.amount).toBe(2);
    expect(body.menu.combined.map((c: { name: string }) => c.name.toLowerCase())).toContain('ui');
  });
});
