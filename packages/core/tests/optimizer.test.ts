import { describe, expect, it } from 'vitest';
import { optimize, type ItemQuote, type OptimizableItem } from '../src/optimizer.js';
import { defaultQuantity, makeQuantity } from '../src/units.js';
import { computeQuote, type PricingInput } from '../src/offers.js';

const storeTitles = {
  lidl: 'Lidl',
  albert_heijn: 'Albert Heijn',
  dirk: 'Dirk',
  kruidvat: 'Kruidvat',
};

function item(id: string, name: string, quantity = defaultQuantity(1)): OptimizableItem {
  return { id, name, quantity, checked: false, inPantry: false };
}

/** Bouwt een prijsregel op dezelfde manier als de backend dat doet. */
function line(
  itemId: string,
  itemName: string,
  input: Omit<PricingInput, 'requiredQuantity'>,
  requiredQuantity = defaultQuantity(1),
): ItemQuote {
  return {
    itemId,
    itemName,
    quantity: requiredQuantity,
    storeId: input.storeId,
    quote: computeQuote({ ...input, requiredQuantity }),
  };
}

const price = (storeId: string, amount: number): Omit<PricingInput, 'requiredQuantity'> => ({
  storeId,
  regularPrice: amount,
  kind: 'price_drop',
});

describe('optimize — alles bij één winkel', () => {
  // Cola: Lidl 2,00 / AH 2,50 / Dirk 1,80 / Kruidvat 2,40  (per stuk, 2 nodig)
  // Melk: Lidl 1,15 / AH 1,19 / Dirk 1,80 / Kruidvat 1,20  (1 liter)
  // Brood: Lidl 2,50 / AH 2,90 / Dirk 2,80 / Kruidvat 3,10
  const items = [item('1', 'Coca-Cola', defaultQuantity(2)), item('2', 'Melk', makeQuantity(1, 'l')), item('3', 'Brood')];

  const quotes: ItemQuote[] = [
    line('1', 'Coca-Cola', price('lidl', 2), defaultQuantity(2)),
    line('1', 'Coca-Cola', price('albert_heijn', 2.5), defaultQuantity(2)),
    line('1', 'Coca-Cola', price('dirk', 1.8), defaultQuantity(2)),
    line('1', 'Coca-Cola', price('kruidvat', 2.4), defaultQuantity(2)),
    line('2', 'Melk', price('lidl', 1.15), makeQuantity(1, 'l')),
    line('2', 'Melk', price('albert_heijn', 1.19), makeQuantity(1, 'l')),
    line('2', 'Melk', price('dirk', 1.8), makeQuantity(1, 'l')),
    line('2', 'Melk', price('kruidvat', 1.2), makeQuantity(1, 'l')),
    line('3', 'Brood', price('lidl', 2.5)),
    line('3', 'Brood', price('albert_heijn', 2.9)),
    line('3', 'Brood', price('dirk', 2.8)),
    line('3', 'Brood', price('kruidvat', 3.1)),
  ];

  const result = optimize(items, quotes, { storeTitles });

  it('berekent een totaal per winkel', () => {
    const totals = Object.fromEntries(result.perStore.map((p) => [p.storeIds[0], p.total]));
    expect(totals.lidl).toBeCloseTo(2 * 2 + 1.15 + 2.5, 5);
    expect(totals.albert_heijn).toBeCloseTo(2 * 2.5 + 1.19 + 2.9, 5);
    expect(totals.dirk).toBeCloseTo(2 * 1.8 + 1.8 + 2.8, 5);
    expect(totals.kruidvat).toBeCloseTo(2 * 2.4 + 1.2 + 3.1, 5);
  });

  it('kiest per product de goedkoopste winkel in de combinatie', () => {
    // Cola -> Dirk (1,80), Melk -> Lidl (1,15), Brood -> Lidl (2,50)
    expect(result.cheapestCombination.total).toBeCloseTo(2 * 1.8 + 1.15 + 2.5, 5);
    expect(result.cheapestCombination.lines.map((l) => l.storeId).sort()).toEqual(['dirk', 'lidl']);
    expect(result.cheapestCombination.lines.find((l) => l.storeId === 'lidl')?.itemCount).toBe(2);
  });

  it('werkt het besparingsbedrag uit ten opzichte van de duurste optie', () => {
    const complete = result.perStore.filter((p) => p.isComplete);
    const mostExpensive = Math.max(...complete.map((p) => p.total));
    expect(result.mostExpensiveTotal).toBeCloseTo(mostExpensive, 5);
    expect(result.savingsVsMostExpensive).toBeCloseTo(mostExpensive - result.cheapestTotal, 5);
    expect(result.savingsVsMostExpensive).toBeGreaterThan(0);
  });

  it('markeert de goedkoopste volledige winkel', () => {
    expect(result.cheapestSingleStore?.storeIds[0]).toBe('lidl');
    expect(result.cheapestSingleStoreTotal).toBeCloseTo(2 * 2 + 1.15 + 2.5, 5);
  });

  it('gebruikt nooit meer winkels dan de goedkoopste combinatie', () => {
    // Lidl heeft alles en is het goedkoopst, dus 1 winkel volstaat.
    expect(result.minimalStores.lines).toHaveLength(1);
    expect(result.minimalStoresTotal).toBeCloseTo(result.cheapestSingleStoreTotal, 5);
  });

  it('staat duurder mag worden wanneer dat minder winkels oplevert', () => {
    // Lidl: cola 2,00 + melk 1,15 + brood 2,50 = 7,65.
    // Combinatie: cola bij Dirk 1,80 -> 3,60, melk 1,15, brood 2,50 = 7,25.
    expect(result.minimalStoresTotal).toBeGreaterThan(result.cheapestTotal);
    expect(result.minimalStoresTotal - result.cheapestTotal).toBeCloseTo(0.4, 5);
  });
});

describe('optimize — winkels met een onvolledig assortiment', () => {
  const items = [item('1', 'A'), item('2', 'B')];
  // Lidl heeft alleen A, Dirk alleen B: geen enkele winkel heeft alles.
  const quotes: ItemQuote[] = [
    line('1', 'A', price('lidl', 1)),
    line('2', 'B', price('dirk', 0.5)),
  ];

  const result = optimize(items, quotes, { storeTitles });

  it('markeert "alles bij één winkel" als onvolledig', () => {
    expect(result.perStore.every((p) => p.isComplete === false)).toBe(true);
    expect(result.mostExpensiveTotal).toBe(0);
    expect(result.cheapestSingleStore).toBeNull();
  });

  it('gebruikt bij "zo min mogelijk winkels" twee winkels, want dat is het minimum', () => {
    expect(result.minimalStores.lines).toHaveLength(2);
    expect(result.minimalStores.total).toBeCloseTo(1.5, 5);
  });

  it('gebruikt bij de goedkoopste combinatie per product de beste winkel', () => {
    expect(result.cheapestTotal).toBeCloseTo(1.5, 5);
    expect(result.cheapestCombination.isComplete).toBe(true);
  });
});

describe('optimize — "zo min mogelijk winkels"', () => {
  it('kiest EEN winkel, ook als dat duurder is dan de combinatie', () => {
    // 2 winkels: 1,00 + 0,50 = 1,50. Alles bij Lidl: 1,00 + 2,00 = 3,00.
    const items = [item('1', 'A'), item('2', 'B')];
    const quotes: ItemQuote[] = [
      line('1', 'A', price('lidl', 1)),
      line('2', 'B', price('dirk', 0.5)),
      line('2', 'B', price('lidl', 2)),
    ];
    const result = optimize(items, quotes, { storeTitles });

    // Goedkoopste combinatie: 1,50 met 2 winkels.
    expect(result.cheapestTotal).toBeCloseTo(1.5, 5);
    expect(result.cheapestCombination.lines).toHaveLength(2);

    // "Zo min mogelijk winkels": 1 winkel (Lidl), 3,00.
    expect(result.minimalStores.lines).toHaveLength(1);
    expect(result.minimalStores.lines[0]?.storeId).toBe('lidl');
    expect(result.minimalStoresTotal).toBeCloseTo(3, 5);
  });

  it('kiest exact één winkel als dat ook het goedkoopst is', () => {
    const items = [item('1', 'A'), item('2', 'B'), item('3', 'C')];
    const quotes: ItemQuote[] = [];
    for (const [id, name] of [['1', 'A'], ['2', 'B'], ['3', 'C']] as const) {
      quotes.push(line(id, name, price('lidl', 1)));
      quotes.push(line(id, name, price('dirk', 5)));
    }
    const result = optimize(items, quotes, { storeTitles });
    expect(result.minimalStores.lines).toHaveLength(1);
    expect(result.minimalStores.lines[0]?.storeId).toBe('lidl');
    expect(result.minimalStoresTotal).toBeCloseTo(3, 5);
    expect(result.cheapestTotal).toBeCloseTo(3, 5);
  });

  it('kiest binnen 1 winkel de goedkoopste', () => {
    const items = [item('1', 'A'), item('2', 'B')];
    const quotes: ItemQuote[] = [
      line('1', 'A', price('lidl', 2)),
      line('1', 'A', price('albert_heijn', 1)),
      line('2', 'B', price('lidl', 2)),
      line('2', 'B', price('albert_heijn', 1.5)),
    ];
    const result = optimize(items, quotes, { storeTitles });
    expect(result.minimalStores.lines).toHaveLength(1);
    expect(result.minimalStores.lines[0]?.storeId).toBe('albert_heijn');
    expect(result.minimalStoresTotal).toBeCloseTo(2.5, 5);
  });
});

describe('optimize — producten zonder prijs', () => {
  it('rekent een product zonder prijs niet mee maar meldt het wel', () => {
    const items = [item('1', 'Bekend product'), item('2', 'Onbekend product')];
    const quotes = [line('1', 'Bekend product', price('lidl', 2))];
    const result = optimize(items, quotes, { storeTitles });
    expect(result.totalUnpricedItems).toBe(1);
    expect(result.hasCompletePricing).toBe(false);
    expect(result.unpriced[0]?.name).toBe('Onbekend product');
    expect(result.cheapestTotal).toBeCloseTo(2, 5);
  });

  it('levert een duidelijke reden wanneer er helemaal geen prijzen zijn', () => {
    const result = optimize([item('1', 'Melk')], [], { storeTitles });
    expect(result.totalPricedItems).toBe(0);
    expect(result.perStore).toHaveLength(0);
    expect(result.unpriced[0]?.reason).toContain('nog geen prijzen');
    expect(result.cheapestTotal).toBe(0);
  });
});

describe('optimize — producten die al in huis zijn', () => {
  it('telt producten die in huis staan niet mee', () => {
    const items: OptimizableItem[] = [item('1', 'Melk'), { ...item('2', 'Brood'), inPantry: true }];
    const quotes = [line('1', 'Melk', price('lidl', 1.2)), line('2', 'Brood', price('lidl', 2.5))];
    const result = optimize(items, quotes, { storeTitles });
    expect(result.cheapestTotal).toBeCloseTo(1.2, 5);
    expect(result.cheapestCombination.lines[0]?.items.map((i) => i.itemName)).toEqual(['Melk']);
  });
});

describe('optimize — aanbiedingen met verplichte bundelgrootte', () => {
  it('rekent 3 cola met "2 voor €5" af als 2 bundels (€10)', () => {
    const items = [item('1', 'Cola', defaultQuantity(3))];
    const quotes = [
      line('1', 'Cola', { storeId: 'lidl', regularPrice: 3.19, kind: 'multipack', conditions: { bundleSize: 2, bundlePrice: 5 } }, defaultQuantity(3)),
    ];
    const result = optimize(items, quotes, { storeTitles });
    expect(result.cheapestTotal).toBeCloseTo(10, 5);
  });

  it('verwerkt aanbiedingen die een klantenkaart vereisen', () => {
    const items = [item('1', 'Yoghurt', defaultQuantity(4))];
    const quotes = [
      line('1', 'Yoghurt', { storeId: 'albert_heijn', regularPrice: 2, kind: 'loyalty', conditions: { requiresLoyaltyCard: true, loyaltyCardName: 'AH Bonuskaart', discountPercent: 25 } }, defaultQuantity(4)),
      line('1', 'Yoghurt', price('lidl', 2.2), defaultQuantity(4)),
    ];
    const withCard = optimize(items, quotes, { storeTitles });
    // Zonder kaart: 4 x 2,20 = 8,80 bij Lidl. Met kaart: 4 x 1,50 = 6,00 bij AH.
    expect(withCard.cheapestTotal).toBeCloseTo(6, 5);

    const withoutCard = optimize(items, quotes, { storeTitles, excludeCardOnlyDeals: true });
    expect(withoutCard.cheapestTotal).toBeCloseTo(8.8, 5);
  });
});
