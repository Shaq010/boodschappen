import { describe, expect, it } from 'vitest';
import { loadConfig, publicConfig, SOURCE_SLUGS, type SourceConfig } from '../src/config.js';
import { AdapterRegistry } from '../src/adapters/index.js';
import { GenericFeedAdapter } from '../src/adapters/generic-feed.js';
import { HttpClient } from '../src/services/http.js';

function source(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    storeId: 'lidl',
    provider: 'LIDL',
    label: 'Lidl',
    baseUrl: 'https://bron.example/lidl',
    apiKey: 'sleutel',
    headers: {},
    documentationUrl: null,
    ttlSeconds: 3600,
    isConfigured: true,
    ...overrides,
  };
}

/** HTTP-client die altijd het meegegeven antwoord teruggeeft, zonder netwerk. */
function stubClient(payload: unknown, init: { status?: number } = {}): HttpClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      statusText: init.status === 200 ? 'OK' : 'Fout',
    })) as unknown as typeof fetch;
  return new HttpClient({
    allowNetwork: true,
    timeoutMs: 100,
    maxRetries: 0,
    retryDelayMs: 0,
    userAgent: 'test',
    fetchImpl,
    sleep: async () => {},
  });
}

describe('winkelstatus zonder gekoppelde bron', () => {
  it('meldt expliciet dat er niets gekoppeld is en geen prijzen toont', () => {
    const adapter = new GenericFeedAdapter({
      storeId: 'albert_heijn',
      storeName: 'Albert Heijn',
      source: source({ storeId: 'albert_heijn', baseUrl: '', isConfigured: false }),
    });

    expect(adapter.isConfigured()).toBe(false);
    const health = adapter.describe();
    expect(health.status).toBe('not_configured');
    expect(health.message).toMatch(/niets verzonnen|niet verzonnen|geen prijzen/i);
    expect(health.requiredEnvVars).toEqual(['SOURCE_ALBERT_HEIJN_BASE_URL', 'SOURCE_ALBERT_HEIJN_API_KEY']);
  });

  it('raakt het netwerk niet aan als er geen bron is', async () => {
    const adapter = new GenericFeedAdapter({
      storeId: 'dirk',
      storeName: 'Dirk',
      source: source({ storeId: 'dirk', baseUrl: '', isConfigured: false }),
    });
    const http = new HttpClient({
      allowNetwork: true,
      timeoutMs: 100,
      maxRetries: 0,
      retryDelayMs: 0,
      userAgent: 'test',
      fetchImpl: (() => {
        throw new Error('er mag geen verzoek gedaan worden');
      }) as unknown as typeof fetch,
    });

    await expect(adapter.fetchOffers(http)).rejects.toThrow(/Geen bron geconfigureerd/);
  });
});

describe('GenericFeedAdapter', () => {
  it('leest een goede aanbiedingslijst', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const http = stubClient({
      source: 'Officiële Lidl-feed',
      offers: [
        {
          id: 'lidl-1',
          title: 'Coca-Cola',
          description: '1,5 l fles',
          kind: 'multipack',
          offerPrice: 4.25,
          regularPrice: 5.19,
          conditions: { bundleSize: 2, bundlePrice: 4.25 },
          validFrom: '2026-09-28',
          validUntil: '2026-10-04',
          gtin: '5449000000996',
          packQuantity: 1.5,
          packUnit: 'l',
        },
      ],
    });

    const result = await adapter.fetchOffers(http);
    expect(result.rejected).toHaveLength(0);
    expect(result.sourceName).toBe('Officiële Lidl-feed');
    expect(result.items).toHaveLength(1);

    const offer = result.items[0]!;
    expect(offer.title).toBe('Coca-Cola');
    expect(offer.offerPrice).toBe(4.25);
    expect(offer.regularPrice).toBe(5.19);
    expect(offer.conditions.bundleSize).toBe(2);
    expect(offer.packQuantity).toBe(1.5);
    expect(offer.validUntil).toBe('2026-10-04');
  });

  it('accepteert een kale lijst en {data:{offers}}', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'dirk', storeName: 'Dirk', source: source({ storeId: 'dirk' }) });

    const plain = await adapter.fetchOffers(stubClient([{ title: 'Appels', offerPrice: 1.99 }]));
    expect(plain.items).toHaveLength(1);

    const nested = await adapter.fetchOffers(stubClient({ data: { offers: [{ title: 'Appels', offerPrice: 1.99 }] } }));
    expect(nested.items).toHaveLength(1);
  });

  it('leest prijzen met prijsdalingen', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'kruidvat', storeName: 'Kruidvat', source: source({ storeId: 'kruidvat' }) });
    const result = await adapter.fetchPrices(
      stubClient({ prices: [{ id: 'k-9', title: 'Tandpasta', regularPrice: 4.5, offerPrice: 2.99, packQuantity: 0.075, packUnit: 'l' }] }),
    );

    expect(result.rejected).toHaveLength(0);
    const price = result.items[0]!;
    expect(price.regularPrice).toBe(4.5);
    expect(price.offerPrice).toBe(2.99);
    expect(price.inStock).toBe(true);
  });

  it('accepteert "price" als alias voor regularPrice, zoals in de documentatie', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    // Precies de vorm uit docs/DATA_SOURCES.md.
    const result = await adapter.fetchPrices(
      stubClient({
        prices: [
          {
            id: 'ah-p-8812',
            gtin: '8710398503968',
            title: 'Coca-Cola regular 1,5 l',
            price: 2.79,
            packQuantity: 1500,
            packUnit: 'ml',
          },
        ],
      }),
    );

    expect(result.rejected).toEqual([]);
    expect(result.items[0]!.regularPrice).toBe(2.79);
    expect(result.items[0]!.packQuantity).toBe(1500);
  });

  it('accepteert "packSize" als alias voor packQuantity', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    // Veel feeds noemen de hoeveelheid packSize. Zonder alias raakt de
    // verpakkingsgrootte verloren en koppelt 1,5 l aan 1 l.
    const result = await adapter.fetchOffers(
      stubClient({ offers: [{ title: 'Cola 1,5 l', offerPrice: 2.19, packSize: 1.5, packUnit: 'l' }] }),
    );

    expect(result.rejected).toEqual([]);
    expect(result.items[0]!.packQuantity).toBe(1.5);
    expect(result.items[0]!.packUnit).toBe('l');
  });

  it('verwerkt het voorbeeld uit de documentatie woordelijk', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'albert_heijn', storeName: 'Albert Heijn', source: source({ storeId: 'albert_heijn' }) });
    // Letterlijk het voorbeeld uit docs/DATA_SOURCES.md. Als de documentatie en
    // de code uiteenlopen, moet hier iets rood worden in plaats van in het
    // donker een feed laten weigeren.
    const voorbeeld = {
      offers: [
        {
          id: 'ah-2026-0042',
          gtin: '8710398503968',
          title: 'Coca-Cola regular 1,5 l',
          description: 'Fles van 1,5 liter',
          kind: 'price_drop',
          offerPrice: 2.25,
          regularPrice: 2.79,
          packQuantity: 1500,
          packUnit: 'ml',
          conditions: { requiresLoyaltyCard: false, maxPerPerson: 6 },
          validFrom: '2026-01-05',
          validUntil: '2026-01-18',
        },
      ],
    };

    const result = await adapter.fetchOffers(stubClient(voorbeeld));

    expect(result.rejected).toEqual([]);
    expect(result.items).toHaveLength(1);
    const offer = result.items[0]!;
    expect(offer.title).toBe('Coca-Cola regular 1,5 l');
    expect(offer.offerPrice).toBe(2.25);
    expect(offer.regularPrice).toBe(2.79);
    expect(offer.packQuantity).toBe(1500);
    expect(offer.packUnit).toBe('ml');
    expect(offer.storeProductId).toBe('ah-2026-0042');
    expect(offer.conditions).toEqual({ requiresLoyaltyCard: false, maxPerPerson: 6 });
  });

  it('wijst regels zonder geldige prijs af in plaats van te gokken', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(
      stubClient({
        offers: [
          { title: 'Zonder prijs' },
          { title: 'Negatieve prijs', offerPrice: -2 },
          { title: 'NaN', offerPrice: 'veel' },
          { title: 'Goed', offerPrice: 1.5 },
        ],
      }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Goed');
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected[0]?.reason).toMatch(/actieprijs/i);
  });

  it('wijst onbekende aanbiedingsvormen af', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(stubClient({ offers: [{ title: 'Melk', offerPrice: 1, kind: 'tijdgever' }] }));
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/Onbekende aanbiedingsvorm/);
  });

  it('leest Europese bedragen met komma', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(stubClient({ offers: [{ title: 'Banaan', offerPrice: '€ 1,29' }] }));
    expect(result.items[0]?.offerPrice).toBe(1.29);
  });

  it('wijst ongeldige datums af in plaats van te raden', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(
      stubClient({
        offers: [
          {
            title: 'Bier',
            offerPrice: 3,
            conditions: { bundleSize: 6, maxPerPerson: 2 },
            validUntil: 'gisteren',
          },
        ],
      }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/geldigheidsdatum/i);
  });

  it('wijst een aanbieding af als er een onbekende voorwaarde in staat', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(
      stubClient({
        offers: [
          {
            title: 'Melk',
            offerPrice: 1,
            // "requiresCard" bestaat niet; de echte naam is "requiresLoyaltyCard".
            conditions: { requiresCard: true },
          },
        ],
      }),
    );
    // Stilzwijgend weglaten zou de kaartvoorwaarde verbergen, dus de regel
    // wordt geweigerd en de reden noemt de onbekende sleutel.
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/onbekende voorwaarden?: requiresCard/i);
  });

  it('wijst een aanbieding af als een voorwaarde geen geldige waarde heeft', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(
      stubClient({ offers: [{ title: 'Melk', offerPrice: 1, conditions: { minQuantity: -3 } }] }),
    );
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/ongeldige waarde bij voorwaarden?: minQuantity/i);
  });

  it('leest de voorwaarden van een loyaltyaanbieding', async () => {
    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    const result = await adapter.fetchOffers(
      stubClient({
        offers: [
          {
            title: 'Melk 1 l',
            offerPrice: 0.99,
            kind: 'loyalty',
            conditions: { requiresLoyaltyCard: true, loyaltyCardName: 'Mijn Lidl' },
          },
        ],
      }),
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.items[0]?.conditions).toMatchObject({ requiresLoyaltyCard: true, loyaltyCardName: 'Mijn Lidl' });
  });

  it('zet de sleutel in de header en niet in de URL', async () => {
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ offers: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = new HttpClient({
      allowNetwork: true,
      timeoutMs: 100,
      maxRetries: 0,
      retryDelayMs: 0,
      userAgent: 'test',
      fetchImpl,
      sleep: async () => {},
    });

    const adapter = new GenericFeedAdapter({ storeId: 'lidl', storeName: 'Lidl', source: source() });
    await adapter.fetchOffers(client);

    expect(urls[0]).toBe('https://bron.example/lidl/offers');
    expect(urls[0]).not.toContain('sleutel');
    expect(headers[0]?.Authorization).toBe('Bearer sleutel');
  });
});

describe('AdapterRegistry', () => {
  it('levert een adapter en status voor elke winkel', () => {
    const registry = new AdapterRegistry(loadConfig());
    const described = registry.describeAll();
    expect(described.map((d) => d.storeId)).toEqual(['lidl', 'albert_heijn', 'dirk', 'kruidvat']);
    // Zonder env-variabelen is geen enkele bron gekoppeld.
    expect(described.every((d) => d.status === 'not_configured')).toBe(true);
    expect(registry.configuredStoreIds()).toEqual([]);
  });

  it('gebruikt de juiste env-variabelen per winkel', () => {
    expect(SOURCE_SLUGS).toEqual({
      lidl: 'LIDL',
      albert_heijn: 'ALBERT_HEIJN',
      dirk: 'DIRK',
      kruidvat: 'KRUIDVAT',
    });
    expect(SOURCE_SLUGS.albert_heijn).toBe('ALBERT_HEIJN');
  });
});

describe('publicConfig', () => {
  it('leakt geen enkele sleutel of endpoint naar de frontend', () => {
    process.env.SOURCE_LIDL_API_KEY = 'TOPGEHEIN-TOKEN';
    process.env.SOURCE_LIDL_BASE_URL = 'https://geheim.example/api';
    process.env.SOURCE_DIRK_API_KEY = 'NOG-GEHEIMER';

    const config = loadConfig();
    const serialised = JSON.stringify(publicConfig(config));

    expect(serialised).not.toContain('TOPGEHEIN-TOKEN');
    expect(serialised).not.toContain('NOG-GEHEIMER');
    expect(serialised).not.toContain('geheim.example');
    // Wel duidelijk zichtbaar dát een bron wél gekoppeld is.
    expect(serialised).toContain('"configured":true');

    delete process.env.SOURCE_LIDL_API_KEY;
    delete process.env.SOURCE_LIDL_BASE_URL;
    delete process.env.SOURCE_DIRK_API_KEY;
  });
});
