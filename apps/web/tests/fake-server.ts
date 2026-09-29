/**
 * Testhulp: een nep-API.
 *
 * De app praat alleen met `/api/...`. Hier staat één fetch-stub die antwoordt
 * met vaste, zelfbedachte testgegevens. Let op: dit zijn testgegevens voor de
 * eigen tests, geen data die in de app terechtkomt.
 */

export interface FakeServerOptions {
  /** Standaardantwoord op elke route die niet apart is ingesteld. */
  lists?: unknown[];
  items?: unknown[];
  sources?: unknown;
  offers?: unknown[];
  optimization?: unknown;
  menu?: unknown;
  pantry?: unknown;
  products?: unknown;
  parse?: unknown;
  today?: unknown;
}

export interface FakeServer {
  fetch: typeof fetch;
  /** Alle opgeroepen URL's, in volgorde. */
  calls: string[];
  /** Laatste body die naar een pad is gestuurd. */
  lastBody: (path: string) => unknown;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const calls: string[] = [];
  const bodies = new Map<string, unknown>();

  const list = { id: 'lijst-1', name: 'Week 1', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01', itemCount: 0, checkedCount: 0 };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const full = url.replace(/^https?:\/\/[^/]+/, '').replace('/api', '');
    // Vastgelegd wordt de volledige vraag inclusief query, zodat tests kunnen
    // controleren welke parameters zijn meegestuurd. De route wordt bepaald op
    // het pad alleen.
    calls.push(full);
    const path = full.split('?')[0]!;

    if (init?.body) {
      try {
        bodies.set(path, JSON.parse(String(init.body)));
      } catch {
        bodies.set(path, init.body);
      }
    }

    if (path === '/sources') {
      return json(options.sources ?? { sources: [], configuredCount: 0, totalStores: 4, hasLivePricing: false });
    }
    if (path === '/lists' && (!init?.method || init.method === 'GET')) {
      return json({ lists: options.lists ?? [list] });
    }
    if (path === '/config') {
      return json({
        version: '1.0.0-test',
        environment: 'test',
        networkEnabled: false,
        defaultCacheTtlSeconds: 900,
        sources: [],
        productMetadataEnabled: false,
      });
    }
    if (path === '/stores') {
      return json({ stores: [] });
    }
    if (path.startsWith('/lists/') && path.endsWith('/optimize')) {
      return json(options.optimization ?? emptyOptimization());
    }
    if (/^\/lists\/[^/]+$/.test(path)) {
      return json({ list: { ...list, itemCount: (options.items ?? []).length }, items: options.items ?? [] });
    }
    if (path === '/offers') {
      return json({ offers: options.offers ?? [], count: (options.offers ?? []).length, hasLivePricing: (options.offers ?? []).length > 0 });
    }
    if (path === '/menu') {
      return json({ menu: options.menu ?? emptyMenu() });
    }
    if (path === '/today') {
      return json(options.today ?? { day: 'dinsdag', needed: [] });
    }
    if (path === '/pantry') {
      return json({ items: options.pantry ?? [] });
    }
    if (path === '/products') {
      return json(options.products ?? { products: [], unverified: 0 });
    }
    if (path === '/parse') {
      return json(options.parse ?? { items: [], message: 'Niets gevonden.', raw: { ignored: [] } });
    }
    return json({});
  }) as unknown as typeof fetch;

  return {
    fetch: fetchImpl,
    calls,
    lastBody: (path: string) => bodies.get(path),
  };
}

export function emptyOptimization() {
  return {
    perStore: [],
    cheapestSingleStore: null,
    cheapestSingleStoreTotal: 0,
    cheapestCombination: {
      key: 'combo', title: 'Goedkoopste combinatie', description: 'Alles bij één winkel.', total: 0,
      pricedItemCount: 0, unpricedItemCount: 0, isComplete: false, missingItems: [], storeIds: [], lines: [],
    },
    minimalStores: {
      key: 'minimal', title: 'Zo min mogelijk winkels', description: 'Alles bij één winkel.', total: 0,
      pricedItemCount: 0, unpricedItemCount: 0, isComplete: false, missingItems: [], storeIds: [], lines: [],
    },
    cheapestTotal: 0,
    minimalStoresTotal: 0,
    mostExpensiveTotal: 0,
    savingsVsMostExpensive: 0,
    unpriced: [],
    totalPricedItems: 0,
    totalUnpricedItems: 0,
    hasCompletePricing: false,
    message: 'Er zijn nog geen prijzen beschikbaar.',
  };
}

export function emptyMenu() {
  return {
    id: 'menu-1',
    weekStart: '2026-01-05',
    title: null,
    meals: [],
    shopping: [],
    combined: [],
    notices: [],
  };
}

/** Een lijstregel zoals de API hem teruggeeft. */
export function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    listId: 'lijst-1',
    name: 'Melk',
    normalizedName: 'melk',
    dimension: 'count',
    amount: 2,
    unit: 'st',
    checked: false,
    inPantry: false,
    note: null,
    origin: 'manual',
    productId: 'p1',
    sortOrder: 1,
    quotes: [],
    best: null,
    cheapestRegular: null,
    ...overrides,
  };
}

/** Een prijsregel voor Lidl; de inhoud van de regel is aan te passen. */
export function makeQuote(overrides: Record<string, unknown> = {}) {
  return makeQuoteFor('lidl', 'Lidl', overrides);
}

/** Dezelfde regel, maar voor een andere winkel. */
export function makeQuoteFor(storeId: string, storeName: string, overrides: Record<string, unknown> = {}) {
  return {
    storeId,
    storeName,
    quote: {
      unitPrice: 0.5,
      savingsPerUnit: 0.25,
      savingsPercent: 33,
      basketCost: 1.0,
      extraUnits: 0,
      label: 'Melk: Actieprijs',
      notices: [],
      warnings: [],
      requiresCard: false,
      ...overrides,
    },
  };
}
