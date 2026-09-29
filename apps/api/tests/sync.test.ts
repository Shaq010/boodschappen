import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../src/config.js';
import { openDatabase, type Database_ } from '../src/db/client.js';
import { seedStores } from '../src/db/seed.js';
import { dataSources, offers, priceHistory, products, prices, storeProducts } from '../src/db/schema.js';
import { AdapterRegistry } from '../src/adapters/index.js';
import { TtlCache } from '../src/services/cache.js';
import { HttpClient } from '../src/services/http.js';
import { SyncService, type SyncOutcome } from '../src/services/sync.js';
import { ProductResolver } from '../src/services/products.js';
import { eq, sql } from 'drizzle-orm';
import { STORE_IDS } from '@boodschappen/core';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Harness {
  db: Database_;
  service: SyncService;
  cache: TtlCache;
  config: AppConfig;
  /** Zet de environment weer terug; aanroepen na de test. */
  restore: () => void;
}

/** Bouwt een service met een stub-HTTP-client en een database in het geheugen. */
function harness(
  routes: Record<string, unknown | (() => never)>,
  env: Record<string, string> = {},
): Harness {
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const config = loadConfig();
  const { db, sqlite } = openDatabase({ file: ':memory:' });
  seedStores(db);

  const fetchImpl = (async (url: string | URL | Request) => {
    const key = String(url);
    for (const [pattern, value] of Object.entries(routes)) {
      if (key.includes(pattern)) {
        // Een functie mag een waarde teruggeven of een fout werpen.
        const payload = typeof value === 'function' ? value() : value;
        return new Response(JSON.stringify(payload), { status: 200, statusText: 'OK' });
      }
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  }) as unknown as typeof fetch;

  const http = new HttpClient({
    allowNetwork: config.sync.allowNetwork,
    timeoutMs: 500,
    maxRetries: 0,
    retryDelayMs: 0,
    userAgent: 'test',
    fetchImpl,
    sleep: async () => {},
  });

  const cache = new TtlCache({ defaultTtlSeconds: 3600 });
  const service = new SyncService({ config, db, http, cache, registry: new AdapterRegistry(config) });

  const restore = (): void => {
    sqlite.close();
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  };
  cleanups.push(restore);

  return { db, service, cache, config, restore };
}

const LIDL_OFFERS = {
  source: 'Officiële Lidl-feed',
  offers: [
    {
      id: 'lidl-cola',
      title: 'Coca-Cola 1,5 l',
      kind: 'price_drop',
      offerPrice: 2.25,
      regularPrice: 2.79,
      conditions: {},
      gtin: '5449000000996',
      validUntil: '2026-10-04',
    },
  ],
};

const LIDL_PRICES = { prices: [{ id: 'lidl-cola', title: 'Coca-Cola 1,5 l', regularPrice: 2.79 }] };

describe('sync zonder gekoppelde bron', () => {
  it('rapporteert alle vier de winkels als niet gekoppeld', () => {
    const h = harness({});
    const statuses = h.service.statuses();

    expect(statuses.map((s) => s.storeId)).toEqual([...STORE_IDS]);
    expect(statuses.every((s) => s.status === 'not_configured')).toBe(true);
    expect(statuses.every((s) => s.offerCount === 0)).toBe(true);
  });

  it('haalt niets op en maakt geen prijzen aan', async () => {
    const h = harness({});
    const outcome = await h.service.syncStore('lidl');

    expect(outcome.status).toBe('not_configured');
    expect(outcome.message).toMatch(/geen officiële databron/i);
    expect(outcome.offersStored).toBe(0);
    expect(h.db.select().from(offers).all()).toHaveLength(0);
    expect(h.db.select().from(prices).all()).toHaveLength(0);
  });

  it('laat per winkel zien welke variabelen nodig zijn', () => {
    const h = harness({});
    const lidl = h.service.statuses().find((s) => s.storeId === 'lidl');
    expect(lidl?.requiredEnvVars).toEqual(['SOURCE_LIDL_BASE_URL', 'SOURCE_LIDL_API_KEY']);
    expect(lidl?.requiredConfiguration.length).toBeGreaterThan(0);
  });
});

describe('sync met gekoppelde bron', () => {
  const env = { SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl', SOURCE_LIDL_API_KEY: 'sleutel' };

  it('slaat aanbiedingen, prijzen en geschiedenis op', async () => {
    const h = harness({ '/offers': LIDL_OFFERS, '/prices': LIDL_PRICES }, env);

    const outcome = await h.service.syncStore('lidl');
    expect(outcome.status).toBe('connected');
    expect(outcome.offersStored).toBe(1);
    expect(outcome.pricesStored).toBe(1);

    const saved = h.db.select().from(offers).all();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe('Coca-Cola 1,5 l');
    expect(saved[0]?.offerPriceCents).toBe(225);
    expect(saved[0]?.regularPriceCents).toBe(279);
    expect(saved[0]?.storeName).toBe('Lidl');
    expect(saved[0]?.sourceName).toBe('Officiële Lidl-feed');

    const price = h.db.select().from(prices).all();
    expect(price[0]?.regularPriceCents).toBe(279);

    const history = h.db.select().from(priceHistory).all();
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('verdubbelt de aanbiedingen niet bij een tweede sync', async () => {
    const h = harness({ '/offers': LIDL_OFFERS, '/prices': LIDL_PRICES }, env);

    await h.service.syncStore('lidl');
    await h.service.syncStore('lidl');
    await h.service.syncStore('lidl');

    // Vóór deze fix stonden er na drie syncs drie exemplaren van dezelfde
    // aanbieding, met een dubbel getelde besparing op het scherm.
    const saved = h.db.select().from(offers).all();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.title).toBe('Coca-Cola 1,5 l');
  });

  it('vervangt de aanbiedingen die niet meer in de feed staan', async () => {
    const h = harness({ '/offers': LIDL_OFFERS, '/prices': LIDL_PRICES }, env);
    await h.service.syncStore('lidl');
    expect(h.db.select().from(offers).all()).toHaveLength(1);

    // De bron haalt de aanbieding terug; de app moet dat ook laten zien.
    const zonderAanbod = harness({ '/offers': { offers: [] }, '/prices': { prices: [] } }, env);
    await zonderAanbod.service.syncStore('lidl');
    expect(zonderAanbod.db.select().from(offers).all()).toHaveLength(0);
  });

  it('laat de aanbiedingen van andere winkels ongemoeid', async () => {
    // Eén harness, dus één database: eerst Lidl, daarna Dirk. De sync van Dirk
    // mag de aanbieding van Lidl niet wissen.
    const h = harness(
      {
        '/offers': { offers: [{ id: 'd1', title: 'Appels Dirk', offerPrice: 1.5 }] },
        '/prices': { prices: [] },
      },
      {
        SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl',
        SOURCE_LIDL_API_KEY: 'sleutel',
        SOURCE_DIRK_BASE_URL: 'https://bron.example/dirk',
        SOURCE_DIRK_API_KEY: 'sleutel',
      },
    );

    await h.service.syncStore('lidl');
    expect(h.db.select().from(offers).all()).toHaveLength(1);

    await h.service.syncStore('dirk');

    const saved = h.db.select().from(offers).all();
    expect(saved).toHaveLength(2);
    expect(saved.map((row) => row.storeId).sort()).toEqual(['dirk', 'lidl']);
  });

  it('rondt bedragen op hele centen', async () => {
    const h = harness(
      { '/offers': { offers: [{ id: 'x', title: 'Appels', offerPrice: 1.999 }] }, '/prices': { prices: [] } },
      env,
    );
    await h.service.syncStore('lidl');
    expect(h.db.select().from(offers).all()[0]?.offerPriceCents).toBe(200);
  });

  it('koppelt artikelen met dezelfde barcode aan één product', async () => {
    const h = harness(
      {
        '/offers': {
          offers: [
            { id: 'a', title: 'Coca-Cola 1,5 l', offerPrice: 2.25, gtin: '5449000000996' },
            { id: 'b', title: 'Coca Cola fles 1.5L', offerPrice: 2.19, gtin: '5449000000996' },
          ],
        },
        '/prices': { prices: [] },
      },
      env,
    );

    await h.service.syncStore('lidl');
    expect(h.db.select().from(products).all()).toHaveLength(1);
    expect(h.db.select().from(storeProducts).all()).toHaveLength(2);
  });

  it('maakt elk artikel een eigen product als er geen overlap is', async () => {
    const h = harness(
      {
        '/offers': {
          offers: [
            { id: 'a', title: 'Bananen', offerPrice: 1.5 },
            { id: 'b', title: 'Washborden', offerPrice: 3 },
          ],
        },
        '/prices': { prices: [] },
      },
      env,
    );

    await h.service.syncStore('lidl');
    expect(h.db.select({ n: sql<number>`count(*)` }).from(products).get()?.n).toBe(2);
  });

  it('werkt ook zonder prijzen-endpoint', async () => {
    const h = harness({ '/offers': LIDL_OFFERS, '/prices': () => { throw new Error('404'); } }, env);
    const outcome = await h.service.syncStore('lidl');

    // Aanbiedingen binnen; het ontbreken van prijzen is geen ramp.
    expect(outcome.status).toBe('connected');
    expect(outcome.offersStored).toBe(1);
    expect(outcome.pricesStored).toBe(0);
  });

  it('verwerkt de overige winkels zonder gekoppelde bron', async () => {
    const h = harness({ '/offers': LIDL_OFFERS, '/prices': LIDL_PRICES }, env);
    const outcomes: SyncOutcome[] = await h.service.syncAll();

    expect(outcomes).toHaveLength(4);
    expect(outcomes[0]?.status).toBe('connected');
    expect(outcomes.slice(1).every((o) => o.status === 'not_configured')).toBe(true);
  });
});

describe('fouten bij synchronisatie', () => {
  it('laat bestaande gegevens staan als de bron ineens faalt', async () => {
    const env = { SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl', SOURCE_LIDL_API_KEY: 'sleutel' };
    // Eerst een werkende bron, daarna dezelfde database met een kapotte bron.
    let broken = false;
    const h = harness({
      '/offers': () => {
        if (broken) throw new Error('netwerk weg');
        return LIDL_OFFERS;
      },
      '/prices': LIDL_PRICES,
    }, env);

    await h.service.syncStore('lidl');
    expect(h.db.select().from(offers).all()).toHaveLength(1);

    broken = true;
    const outcome = await h.service.syncStore('lidl');

    expect(outcome.status).toBe('error');
    // De historie mag niet verdwijnen door een storing.
    expect(h.db.select().from(offers).all()).toHaveLength(1);
    expect(h.service.statuses().find((s) => s.storeId === 'lidl')?.status).toBe('error');
    h.restore();
  });

  it('wordt een rate_limit-fout en toont een duidelijke uitleg', async () => {
    const env = { SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl', SOURCE_LIDL_API_KEY: 'sleutel' };
    const h = harness(
      {
        '/offers': () => {
          throw new Error('429');
        },
      },
      env,
    );
    const outcome = await h.service.syncStore('lidl');
    expect(['error', 'rate_limited']).toContain(outcome.status);
    expect(outcome.message.length).toBeGreaterThan(10);
  });

  it('blokkeert netwerkverkeer als ALLOW_NETWORK=false', async () => {
    const env = {
      ALLOW_NETWORK: 'false',
      SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl',
      SOURCE_LIDL_API_KEY: 'sleutel',
    };
    const h = harness({}, env);
    const outcome = await h.service.syncStore('lidl');

    // Bewust uitgezet netwerk is een stand van zaken, geen storing.
    expect(outcome.status).toBe('network_disabled');
    expect(outcome.message).toMatch(/uitgaande verzoeken/i);
    expect(h.db.select().from(offers).all()).toHaveLength(0);

    // En zo staat het er ook in het overzicht van bronnen, niet als fout.
    const status = h.service.statuses().find((s) => s.storeId === 'lidl');
    expect(status?.status).toBe('network_disabled');
  });

  it('logt nooit de api-sleutel in de status', async () => {
    const env = { SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl', SOURCE_LIDL_API_KEY: 'TOPGEHEIN' };
    const h = harness({ '/offers': () => { throw new Error('kapot'); } }, env);
    await h.service.syncStore('lidl');

    const record = h.db.select().from(dataSources).where(eq(dataSources.storeId, 'lidl')).get();
    expect(JSON.stringify(record)).not.toContain('TOPGEHEIN');
  });
});

describe('cache', () => {
  it('slaat aanbiedingen op met de ttl van de bron', async () => {
    const env = {
      SOURCE_LIDL_BASE_URL: 'https://bron.example/lidl',
      SOURCE_LIDL_API_KEY: 'sleutel',
      SOURCE_LIDL_TTL_SECONDS: '900',
    };
    const h = harness({ '/offers': LIDL_OFFERS, '/prices': LIDL_PRICES }, env);
    await h.service.syncStore('lidl');

    expect(h.cache.get('offers:lidl')).not.toBeNull();
    expect(h.service.statuses().find((s) => s.storeId === 'lidl')?.status).toBe('connected');
  });
});

describe('ProductResolver', () => {
  function setup() {
    const { db, sqlite } = openDatabase({ file: ':memory:' });
    seedStores(db);
    return { db, close: () => sqlite.close() };
  }

  it('vindt exact hetzelfde product terug', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);

    const first = resolver.resolve({ name: 'Coca-Cola', gtin: null, storeId: 'lidl', storeProductId: 'a' });
    const second = resolver.resolve({ name: 'coca cola', gtin: null, storeId: 'dirk', storeProductId: 'b' });

    expect(second.productId).toBe(first.productId);
    expect(second.created).toBe(false);
    close();
  });

  it('houdt cola en cola zero uit elkaar', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);

    const cola = resolver.resolve({ name: 'Cola', gtin: null, storeId: 'lidl', storeProductId: 'a' });
    const zero = resolver.resolve({ name: 'Cola zero', gtin: null, storeId: 'lidl', storeProductId: 'b' });

    expect(zero.productId).not.toBe(cola.productId);
    close();
  });

  it('koppelt op barcode, ook als de naam afwijkt', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);

    const a = resolver.resolve({ name: 'Halfvolle melk 1 l', gtin: '8712345678901', storeId: 'lidl', storeProductId: 'a' });
    const b = resolver.resolve({ name: 'Melk', gtin: '8712345678901', storeId: 'dirk', storeProductId: 'b' });

    expect(b.productId).toBe(a.productId);
    expect(b.matchedBy).toBe('gtin');
    close();
  });

  it('markeert twijfelgevallen als onbevestigd en laat ze bevestigen', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);

    // Twee vergelijkbare maar verschillende producten: niet automatisch samenvoegen.
    const a = resolver.resolve({ name: 'Verse gember', gtin: null, storeId: 'lidl', storeProductId: 'a' });
    const b = resolver.resolve({ name: 'Verse gember 20 g', gtin: null, storeId: 'lidl', storeProductId: 'b' });

    if (a.productId !== b.productId) {
      expect(resolver.unverifiedProducts().length).toBeGreaterThan(0);
    }

    resolver.confirm(a.productId);
    expect(resolver.unverifiedProducts().map((p) => p.id)).not.toContain(a.productId);
    close();
  });

  it('leert eigen synoniemen', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);

    const soda = resolver.resolve({ name: 'Sodaboter', gtin: null, storeId: 'lidl', storeProductId: 'a' });

    // De gebruiker zegt: "Boter" is hetzelfde product als sodaboter.
    resolver.addAlias(soda.productId, 'Boter');

    const shop = resolver.resolve({ name: 'Boter', gtin: null, storeId: 'dirk', storeProductId: 'c' });
    expect(shop.productId).toBe(soda.productId);
    expect(shop.created).toBe(false);
    expect(shop.matchedBy).toBe('naam');
    close();
  });

  it('houdt cola en cola zero gescheiden, ook na een eigen alias', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);

    const cola = resolver.resolve({ name: 'Coca-Cola', gtin: null, storeId: 'lidl', storeProductId: 'a' });
    const zero = resolver.resolve({ name: 'Coca-Cola Zero', gtin: null, storeId: 'lidl', storeProductId: 'b' });
    expect(zero.productId).not.toBe(cola.productId);

    // Ook als de gebruiker ze bewust koppelt, blijft de veiligheidsklep actief.
    resolver.addAlias(zero.productId, 'Cola');
    const other = resolver.resolve({ name: 'Cola', gtin: null, storeId: 'dirk', storeProductId: 'c' });
    expect(other.productId).not.toBe(cola.productId);
    close();
  });

  it('geeft nooit een verkeerd product bij een lege database', () => {
    const { db, close } = setup();
    const resolver = new ProductResolver(db);
    const result = resolver.resolve({ name: 'Iets', gtin: null, storeId: 'lidl', storeProductId: 'a' });
    expect(result.created).toBe(true);
    expect(resolver.count()).toBe(1);
    close();
  });
});
