import { describe, expect, it } from 'vitest';
import { euro } from '../src/format.js';

/** Nederlandse bedragen gebruiken een niet-verbreekbare spatie voor de euro. */
const money = euro;
import { computeQuote, effectiveUnitPrice, offerLabel, unitPriceBreakdown } from '../src/offers.js';
import { defaultQuantity, makeQuantity } from '../src/units.js';

describe('offerLabel', () => {
  it('beschrijft een multipack', () => {
    expect(offerLabel('multipack', { bundleSize: 2, bundlePrice: 5 }, 'Coca-Cola')).toBe(
      `Coca-Cola: 2 voor ${money(5)}`,
    );
  });

  it('beschrijft 1+1 gratis als 2 voor 1x de prijs', () => {
    expect(offerLabel('multipack', { bundleSize: 2, bundlePrice: 2.5 }, 'Bier')).toBe(`Bier: 2 voor ${money(2.5)}`);
  });

  it('beschrijft "2e halve prijs"', () => {
    expect(offerLabel('second_half', { secondUnitDiscount: 0.5 }, 'Yoghurt')).toBe('Yoghurt: 2e halve prijs');
  });

  it('noemt de klantenkaart', () => {
    expect(offerLabel('loyalty', { discountPercent: 30, loyaltyCardName: 'AH Bonuskaart' })).toContain('AH Bonuskaart');
  });

  it('noemt de kaart bij een loyaltyprijs zonder kortingspercentage', () => {
    // Anders zou er alleen "Actieprijs" staan, terwijl de prijs kaartgebonden is.
    expect(offerLabel('loyalty', { requiresLoyaltyCard: true, loyaltyCardName: 'Mijn AH' })).toBe(
      'Alleen met Mijn AH',
    );
    expect(offerLabel('loyalty', { requiresLoyaltyCard: true })).toBe('Alleen met klantenkaart');
  });
});

describe('effectiveUnitPrice', () => {
  it('deelt een multipackprijs door het aantal', () => {
    const unit = effectiveUnitPrice({
      storeId: 'lidl',
      regularPrice: 2.5,
      offerPrice: 5,
      kind: 'multipack',
      conditions: { bundleSize: 2, bundlePrice: 5 },
      requiredQuantity: defaultQuantity(2),
    });
    expect(unit).toBe(2.5);
  });

  it('berekent het gemiddelde bij "2e halve prijs"', () => {
    const unit = effectiveUnitPrice({
      storeId: 'dirk',
      regularPrice: 2,
      kind: 'second_half',
      conditions: { secondUnitDiscount: 0.5 },
      requiredQuantity: defaultQuantity(2),
    });
    expect(unit).toBe(1.5);
  });
});

describe('computeQuote — voorwaarden correct afhandelen', () => {
  it('rekent "2 voor €5,00" met 3 stuks nodig af op 2 bundels van 4 stuks', () => {
    const quote = computeQuote({
      storeId: 'lidl',
      regularPrice: 3.19,
      offerPrice: 5,
      kind: 'multipack',
      conditions: { bundleSize: 2, bundlePrice: 5 },
      requiredQuantity: defaultQuantity(3),
    });
    expect(quote.basketCost).toBe(10);
    expect(quote.extraUnits).toBe(1);
    expect(quote.unitPrice).toBe(2.5);
    expect(quote.notices.join(' ')).toContain('Verkoop per 2');
  });

  it('rekent een los product tegen de actieprijs af', () => {
    const quote = computeQuote({
      storeId: 'albert_heijn',
      regularPrice: 2.29,
      offerPrice: 1.79,
      kind: 'price_drop',
      requiredQuantity: defaultQuantity(2),
    });
    expect(quote.basketCost).toBe(3.58);
    expect(quote.savingsPerUnit).toBe(0.5);
  });

  it('rekent 1,5 liter melk af tegen de prijs per fles', () => {
    const quote = computeQuote({
      storeId: 'albert_heijn',
      regularPrice: 1.15,
      offerPrice: 0.99,
      kind: 'price_drop',
      packQuantity: makeQuantity(1.5, 'l'),
      requiredQuantity: makeQuantity(1.5, 'l'),
    });
    expect(quote.basketCost).toBeCloseTo(0.99, 5);
  });

  it('rekent gewicht af: 1 kg gehakt bij €9,99/kg', () => {
    const quote = computeQuote({
      storeId: 'lidl',
      regularPrice: 9.99,
      kind: 'price_drop',
      packQuantity: makeQuantity(1, 'kg'),
      requiredQuantity: makeQuantity(1.5, 'kg'),
    });
    // 1,5 kg betekent 1,5 van een 1-kg-verpakking. Bedragen worden op centen
    // afgerond, dus 14,985 -> 14,99.
    expect(quote.basketCost).toBe(14.99);
  });

  it('rekent gewicht af bij een verpakking van 500 g', () => {
    const quote = computeQuote({
      storeId: 'lidl',
      regularPrice: 5.49,
      kind: 'price_drop',
      packQuantity: makeQuantity(500, 'g'),
      requiredQuantity: makeQuantity(1, 'kg'),
    });
    // 1 kg vraagt 2 verpakkingen van 500 g.
    expect(quote.basketCost).toBeCloseTo(10.98, 5);
  });

  it('laat zien dat een klantenkaart nodig is', () => {
    const quote = computeQuote({
      storeId: 'albert_heijn',
      regularPrice: 4.99,
      kind: 'loyalty',
      conditions: { requiresLoyaltyCard: true, loyaltyCardName: 'AH Bonuskaart', discountPercent: 30 },
      requiredQuantity: defaultQuantity(1),
    });
    expect(quote.requiresCard).toBe(true);
    expect(quote.unitPrice).toBeCloseTo(3.49, 5);
    expect(quote.unitPriceWithoutCard).toBe(4.99);
    expect(quote.basketCostWithoutCard).toBe(4.99);
    expect(quote.notices.join(' ')).toContain('AH Bonuskaart');
  });

  it('respecteert een minimumaantal', () => {
    const quote = computeQuote({
      storeId: 'dirk',
      regularPrice: 1.5,
      offerPrice: 1,
      kind: 'min_quantity',
      conditions: { minQuantity: 3 },
      requiredQuantity: defaultQuantity(1),
    });
    expect(quote.basketCost).toBe(3);
    expect(quote.notices.join(' ')).toContain('Minimaal 3');
  });

  it('meldt een limiet per persoon', () => {
    const quote = computeQuote({
      storeId: 'dirk',
      regularPrice: 2,
      offerPrice: 1,
      kind: 'price_drop',
      conditions: { maxPerPerson: 2 },
      requiredQuantity: defaultQuantity(1),
    });
    expect(quote.warnings.join(' ')).toContain('maximaal 2 per persoon');
  });

  it('meldt wanneer een product niet op voorraad is', () => {
    const quote = computeQuote({
      storeId: 'kruidvat',
      regularPrice: 3,
      kind: 'price_drop',
      requiredQuantity: defaultQuantity(1),
      inStock: false,
    });
    expect(quote.warnings.join(' ')).toContain('niet op voorraad');
  });

  it('verwerkt "2e halve prijs" bij een oneven aantal', () => {
    const quote = computeQuote({
      storeId: 'dirk',
      regularPrice: 2.5,
      kind: 'second_half',
      conditions: { secondUnitDiscount: 0.5 },
      requiredQuantity: defaultQuantity(3),
    });
    // 3 nodig -> 4 kopen (2 tweetallen): 2x (2,50 + 1,25) = 7,50
    expect(quote.basketCost).toBeCloseTo(7.5, 5);
    expect(quote.extraUnits).toBe(1);
  });
});

describe('unitPriceBreakdown', () => {
  it('berekent de prijs per kilogram', () => {
    const quote = computeQuote({
      storeId: 'lidl',
      regularPrice: 9.98,
      kind: 'price_drop',
      packQuantity: makeQuantity(1, 'kg'),
      requiredQuantity: defaultQuantity(1),
    });
    const breakdown = unitPriceBreakdown(quote, makeQuantity(1, 'kg'));
    expect(breakdown.perKg).toBeCloseTo(9.98, 5);
  });

  it('berekent de prijs per liter', () => {
    const quote = computeQuote({
      storeId: 'lidl',
      regularPrice: 0.89,
      kind: 'price_drop',
      packQuantity: makeQuantity(1, 'l'),
      requiredQuantity: defaultQuantity(1),
    });
    const breakdown = unitPriceBreakdown(quote, makeQuantity(1, 'l'));
    expect(breakdown.perLiter).toBeCloseTo(0.89, 5);
  });

  it('geeft niets terug wanneer de verpakkingsgrootte onbekend is', () => {
    const quote = computeQuote({
      storeId: 'lidl',
      regularPrice: 1.5,
      kind: 'price_drop',
      requiredQuantity: defaultQuantity(1),
    });
    const breakdown = unitPriceBreakdown(quote, null);
    expect(breakdown.perKg).toBeNull();
    expect(breakdown.perLiter).toBeNull();
  });
});
