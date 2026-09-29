import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/services/http.js';
import { PrijsprofeetAdapter, type PrijsprofeetConfig } from '../src/adapters/prijsprofeet.js';

/**
 * Deze tests draaien tegen de echte antwoordvorm van PrijsProfeet (opgeslagen
 * op 28 september 2026), niet tegen een verzonnen schema. Vooral de velden
 * `unit`, `quantity` en `promotion_status` hebben een verrassende vorm; de
 * testdata hieronder is daarom gekopieerd uit echte responses.
 */
const TODAY = '2026-09-28';

function config(overrides: Partial<PrijsprofeetConfig> = {}): PrijsprofeetConfig {
  return {
    baseUrl: 'https://www.prijsprofeet.nl/api/v1',
    apiKey: 'sleutel',
    userAgent: 'BoodschappenApp/1.0',
    isConfigured: true,
    ...overrides,
  };
}

/** HTTP-client die een vast antwoord teruggeeft en nergens het netwerk opgaat. */
function stubClient(payload: unknown): HttpClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(payload), { status: 200, statusText: 'OK' })) as unknown as typeof fetch;
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

function page(products: unknown[], extra: Record<string, unknown> = {}): unknown {
  return { total: products.length, page: 1, page_size: 100, products, retailer_filter: null, ...extra };
}

function adapterFor(storeId: 'lidl' | 'albert_heijn' | 'dirk' = 'dirk', cfg = config()) {
  return new PrijsprofeetAdapter(storeId, cfg, { today: () => TODAY });
}

/** Echte rij: DekaMarkt 2+2 gratis, 4 voor 1,28. */
const onePlusOne = {
  product_id: '1227319_2026-09-28',
  name: 'Yum Yum Noodles garnalen',
  brand: 'Yum Yum',
  ean: '8852018101055',
  quantity: '60 g',
  unit: 'kg',
  price: 0.32,
  original_price: 0.64,
  discount_percentage: 50.0,
  multi_buy_quantity: 4,
  multi_buy_price: 1.28,
  retailer: 'dekamarkt',
  is_promotional: true,
  promotion_type: 'one_plus_one',
  promotion_status: 'active',
  valid_from: '2026-09-28',
  valid_until: '2026-10-04',
  valid_until_estimated: null,
  loyalty_price: null,
  loyalty_program: null,
  max_per_customer: null,
  promotional_keywords: ['2+2 GRATIS'],
};

/** Echte rij: AH 3 voor 0,89, en `unit` is hier 'stuk'. */
const multiBuy = {
  product_id: 'ah_wi605275',
  name: 'AH Winterpeen',
  brand: 'AH',
  ean: '8710400226055',
  quantity: 'per stuk',
  unit: 'stuk',
  price: 0.3,
  original_price: 0.45,
  discount_percentage: 34.07,
  multi_buy_quantity: 3,
  multi_buy_price: 0.89,
  retailer: 'albert_heijn',
  is_promotional: true,
  promotion_type: 'multi_buy',
  promotion_status: 'active',
  valid_from: '2026-09-28',
  valid_until: '2026-10-04',
  valid_until_estimated: null,
  loyalty_price: null,
  promotional_keywords: ['3 VOOR 0.89'],
};

/** Echte rij: Lidl Plus-ledenprijs, en de einddatum is geschat. */
const loyaltyRow = {
  product_id: 'lidl_123',
  name: 'Volkorenbol',
  brand: 'Lidl',
  ean: null,
  quantity: '4-pack',
  unit: null,
  price: 0.55,
  original_price: null,
  discount_percentage: null,
  multi_buy_quantity: null,
  multi_buy_price: null,
  retailer: 'lidl',
  is_promotional: true,
  promotion_type: 'limited',
  promotion_status: 'active',
  valid_from: '2026-09-28',
  valid_until: '2026-09-29',
  valid_until_estimated: true,
  loyalty_price: 0.29,
  loyalty_program: 'Lidl Plus',
  max_per_customer: 2,
  promotional_keywords: null,
};

/** Echte rij: begint morgen, dus vandaag nog niet te kopen. */
const upcomingRow = {
  ...multiBuy,
  product_id: 'future_1',
  promotion_status: 'upcoming',
  valid_from: '2026-09-29',
  valid_until: '2026-10-05',
};

describe('PrijsProfeet: alleen acties die vandaag te kopen zijn', () => {
  it('laat een actie van vandaag door', async () => {
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([multiBuy])));
    expect(result.rejected).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe('AH Winterpeen');
  });

  it('weigert een actie die pas morgen begint, met reden', async () => {
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([upcomingRow])));
    expect(result.items).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/2026-09-29/);
    expect(result.rejected[0]!.reason).toMatch(/vandaag nog niet te kopen/);
  });

  it('weigert een actie die al verlopen is', async () => {
    const verlopen = { ...multiBuy, product_id: 'oud', valid_from: '2026-09-20', valid_until: '2026-09-26' };
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([verlopen])));
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/verlopen/);
  });

  it('weigert een "upcoming" zonder bruikbare startdatum in plaats van hem te tonen', async () => {
    const zonderDatum = { ...upcomingRow, product_id: 'z', valid_from: null };
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([zonderDatum])));
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/niet als actie van vandaag te verifiëren/);
  });

  it('weigert historische en schapprijs-rijen, want dat is geen actieprijs', async () => {
    const historisch = { ...multiBuy, product_id: 'h', promotion_status: 'historical' };
    const schap = { ...multiBuy, product_id: 's', promotion_status: 'shelf' };
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([historisch, schap])));
    expect(result.items).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason).join(' ')).toMatch(/Verleden actie/);
    expect(result.rejected.map((r) => r.reason).join(' ')).toMatch(/Pro-plan/);
  });

  it('verwerkt een exacte grensdatum: geldig tot en met vandaag telt mee', async () => {
    const vandaag = { ...multiBuy, product_id: 'g', valid_from: '2026-09-21', valid_until: TODAY };
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([vandaag])));
    expect(result.items).toHaveLength(1);
  });
});

describe('PrijsProfeet: bundels', () => {
  it('zet "2+2 gratis" om naar een pakket van 4 voor het totaalbedrag', async () => {
    const result = await adapterFor('dirk').fetchOffers(stubClient(page([onePlusOne])));
    const offer = result.items[0]!;

    // `price` is de stukprijs; het pakket is wat je afgeeft.
    expect(offer.offerPrice).toBe(0.32);
    expect(offer.kind).toBe('multipack');
    expect(offer.conditions.bundleSize).toBe(4);
    expect(offer.conditions.bundlePrice).toBe(1.28);
    expect(offer.conditions.discountPercent).toBe(50);
  });

  it('zet "3 voor 0,89" om naar een pakket van 3', async () => {
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([multiBuy])));
    const offer = result.items[0]!;
    expect(offer.conditions.bundleSize).toBe(3);
    expect(offer.conditions.bundlePrice).toBe(0.89);
  });

  it('leest eenheid "L" met hoofdletter als liter, niet als onbekend', async () => {
    const liter = { ...multiBuy, product_id: 'l', quantity: '1 L', unit: 'L' };
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([liter])));
    expect(result.items[0]!.packQuantity).toBe(1);
    expect(result.items[0]!.packUnit).toBe('l');
  });

  it('negeert "unit" als verpakkingseenheid; "100 g" met unit "kg" is 100 gram', async () => {
    const gram = { ...multiBuy, product_id: 'g100', quantity: '100 g', unit: 'kg' };
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([gram])));
    // Zou je `unit` als verpakking nemen, dan werd dit een pak van 100 kg.
    expect(result.items[0]!.packQuantity).toBe(100);
    expect(result.items[0]!.packUnit).toBe('g');
  });

  it('leest "per stuk" als één exemplaar', async () => {
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(page([multiBuy])));
    expect(result.items[0]!.packQuantity).toBe(1);
    expect(result.items[0]!.packUnit).toBe('stuk');
  });

  it('gokt geen volume bij "4-pack"; het aantal blijft onbekend', async () => {
    const result = await adapterFor('lidl').fetchOffers(stubClient(page([loyaltyRow])));
    // "4-pack" is een verpakkingsomschrijving, geen maat. Er wordt geen 4
    // verondersteld, want dan zou het product als 4 onbekende porties tellen.
    expect(result.items[0]!.packQuantity).toBeNull();
    expect(result.items[0]!.packDescription).toBe('4-pack');
  });
});

describe('PrijsProfeet: eerlijkheid over de bron', () => {
  it('toont een ledenprijs in de beschrijving in plaats van hem te verzwijgen', async () => {
    const result = await adapterFor('lidl').fetchOffers(stubClient(page([loyaltyRow])));
    const offer = result.items[0]!;
    expect(offer.offerPrice).toBe(0.55);
    expect(offer.description).toMatch(/Lidl Plus/);
    expect(offer.description).toMatch(/0,29/);
  });

  it('merkt op dat de einddatum geschat is', async () => {
    const result = await adapterFor('lidl').fetchOffers(stubClient(page([loyaltyRow])));
    expect(result.items[0]!.description).toMatch(/einddatum geschat/);
  });

  it('neemt max_per_customer over als maximum per persoon', async () => {
    const result = await adapterFor('lidl').fetchOffers(stubClient(page([loyaltyRow])));
    expect(result.items[0]!.conditions.maxPerPerson).toBe(2);
  });

  it('leest de EAN over, maar niet als die onbruikbaar is', async () => {
    const metEan = await adapterFor('dirk').fetchOffers(stubClient(page([onePlusOne])));
    expect(metEan.items[0]!.gtin).toBe('8852018101055');
    const zonderEan = await adapterFor('lidl').fetchOffers(stubClient(page([loyaltyRow])));
    expect(zonderEan.items[0]!.gtin).toBeNull();
  });

  it('noemt de bron bij de resultaten', async () => {
    const result = await adapterFor('dirk').fetchOffers(stubClient(page([onePlusOne])));
    expect(result.sourceName).toMatch(/PrijsProfeet/);
  });
});

describe('PrijsProfeet: niet op de verkeerde winkel vertrouwen', () => {
  it('slaat niets op als de bron het winkelfilter negeerde', async () => {
    const payload = page([multiBuy], { retailer_filter: { applied: [], ignored: ['albert_heijn'] } });
    await expect(adapterFor('albert_heijn').fetchOffers(stubClient(payload))).rejects.toThrow(
      /negeerde het winkelfilter/,
    );
  });

  it('accepteert een antwoord waarin het filter wél is toegepast', async () => {
    const payload = page([multiBuy], { retailer_filter: { applied: ['albert_heijn'], ignored: [] } });
    const result = await adapterFor('albert_heijn').fetchOffers(stubClient(payload));
    expect(result.items).toHaveLength(1);
  });
});

describe('PrijsProfeet: sleutel en winkeldekkingsgraad', () => {
  it('raakt het netwerk niet aan zonder sleutel en slaat niets op', async () => {
    // Elke fetch is een fout: bewijs dat er zonder sleutel niets wordt opgehaald.
    const fetchImpl = (async () => {
      throw new Error('er hoort helemaal geen netwerkverzoek te komen');
    }) as unknown as typeof fetch;
    const http = new HttpClient({
      allowNetwork: true,
      timeoutMs: 100,
      maxRetries: 0,
      retryDelayMs: 0,
      userAgent: 'test',
      fetchImpl,
      sleep: async () => {},
    });

    const adapter = new PrijsprofeetAdapter('dirk', config({ apiKey: '', isConfigured: false }));
    expect(adapter.isConfigured()).toBe(false);
    expect(adapter.describe().status).toBe('not_configured');
    await expect(adapter.fetchOffers(http)).rejects.toThrow(/sleutel/);
  });

  it('meldt welke omgevingsvariabele nodig is, zonder de sleutel te tonen', () => {
    const health = adapterFor('dirk', config({ apiKey: 'GEHEIM-abc123' })).describe();
    expect(health.status).toBe('connected');
    expect(health.requiredEnvVars).toEqual(['PRIJSPROFEET_API_KEY']);
    expect(JSON.stringify(health)).not.toContain('GEHEIM-abc123');
  });

  it('laat zich niet aanmaken voor Kruidvat: die winkel levert PrijsProfeet niet', () => {
    expect(() => new PrijsprofeetAdapter('kruidvat', config())).toThrow(/Kruidvat/);
  });

  it('noemt in de status dat prijzen indicatief zijn', () => {
    expect(adapterFor('dirk').describe().message).toMatch(/indicatief/);
  });
});
