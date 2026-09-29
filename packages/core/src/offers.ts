/**
 * Rekenkunde voor aanbiedingen.
 *
 * Nederlandse supermarkten gebruiken veel verschillende actievormen. Deze module
 * zet ze om in één model en berekent voor elke aanbieding:
 *  - de prijs per verpakking (waarvoor je daadwerkelijk betaalt)
 *  - de prijs per kilogram / per liter / per stuk waar bekend
 *  - wat je moet betalen om de gewenste hoeveelheid in huis te krijgen,
 *    inclusief het feit dat je bij "2 voor 5,00" vaak méér moet nemen dan nodig
 *  - alle voorwaarden waaraan je moet voldoen
 *
 * Belangrijk principe: een aanbieding wordt nooit mooier voorgesteld dan hij is.
 * Als er een klantenkaart nodig is, staat dat er expliciet bij en is de prijs zonder
 * kaart zichtbaar.
 */

import { type Quantity, roundMoney, roundQuantity } from './units.js';

export type OfferKind =
  | 'price_drop'
  | 'multipack'
  | 'second_half'
  | 'loyalty'
  | 'min_quantity'
  | 'bundle'
  | 'per_volume'
  | 'cashback';

/** Alle voorwaarden van één aanbieding, in machineleesbare vorm. */
export interface OfferConditions {
  /** "2 voor €5,00" -> bundleSize 2, bundlePrice 5. */
  bundleSize?: number;
  bundlePrice?: number;
  /** "2e halve prijs" -> 0.5 */
  secondUnitDiscount?: number;
  /** Alleen geldig vanaf een bepaald aantal, bv. 3 stuks. */
  minQuantity?: number;
  /** Maximaal per persoon, bv. 2. */
  maxPerPerson?: number;
  /** Vereist een bonuskaart/klantenkaart voor deze prijs. */
  requiresLoyaltyCard?: boolean;
  /** Naam van de kaart, bv. "AH Bonuskaart" of "Lidl Plus". */
  loyaltyCardName?: string;
  /** Korting in euro's bij aankoop (bv. €2,00 korting bij €20). */
  instantSavings?: number;
  /** Waarde van het cadeau, bv. "gratis knoflooktenen bij 2 pakken". */
  giftValue?: number;
  /** Korting in procenten op de normale prijs, bv. 30 -> 30%. */
  discountPercent?: number;
}

export interface PriceQuote {
  storeId: string;
  /** Prijs die een gemiddelde klant betaalt, kaart meegerekend indien gunstiger. */
  unitPrice: number;
  /** Prijs die je betaalt zonder loyaltykaart, indien relevant. */
  unitPriceWithoutCard: number | null;
  /** Korting in euro per eenheid t.o.v. de normale prijs. */
  savingsPerUnit: number;
  savingsPercent: number | null;
  /** Muntbedrag om `requiredQuantity` te verkrijgen. */
  basketCost: number;
  /** Muntbedrag om `requiredQuantity` te verkrijgen zonder loyaltykaart. */
  basketCostWithoutCard: number | null;
  /** Aantal eenheden dat je extra moet/meebrengt door de actie. */
  extraUnits: number;
  /** Mensenleesbare omschrijving, bv. "2 voor €5,00". */
  label: string;
  /** Voorwaarden als korte, zichtbare punten. */
  notices: string[];
  /** Waarschuwingen die echt aandacht vragen. */
  warnings: string[];
  /** Vereist een klantenkaart voor de beste prijs. */
  requiresCard: boolean;
  /** Beschikbare hoeveelheid per prijsseenheid, bv. 1.5 voor "1,5 l"-flessen. */
  amountPerUnit: Quantity | null;
}

/** Alles wat nodig is om een prijs te kunnen berekenen. */
export interface PricingInput {
  storeId: string;
  /** Normale prijs per verpakking, indien bekend. */
  regularPrice?: number | null;
  /** Actieprijs per verpakking, indien bekend. */
  offerPrice?: number | null;
  /** Aanbiedingsvorm. */
  kind: OfferKind;
  conditions?: OfferConditions;
  /** Gewicht of volume van één verpakking, indien bekend. */
  packQuantity?: Quantity | null;
  /** Wat de gebruiker nodig heeft. */
  requiredQuantity: Quantity;
  /** Naam van de aanbieding, bv. "Coca-Cola 2 liter". */
  productName?: string;
  /** Beschikbaarheid in dit assortiment. */
  inStock?: boolean;
}

const MONEY = (value: number): string =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(value);

/** Geeft de actieprijs per verpakking terug, los van de overige voorwaarden. */
export function effectiveUnitPrice(input: PricingInput): number {
  const conditions = input.conditions ?? {};
  const { regularPrice, offerPrice, kind } = input;

  switch (kind) {
    case 'multipack':
    case 'bundle': {
      if (conditions.bundleSize && conditions.bundlePrice != null) {
        return conditions.bundlePrice / conditions.bundleSize;
      }
      return offerPrice ?? regularPrice ?? 0;
    }
    case 'second_half': {
      const base = offerPrice ?? regularPrice ?? 0;
      const discount = conditions.secondUnitDiscount ?? 0.5;
      // Gemiddelde prijs per eenheid binnen een paar.
      return base * ((2 - discount) / 2);
    }
    case 'per_volume': {
      if (conditions.bundleSize && conditions.bundlePrice != null) {
        return conditions.bundlePrice / conditions.bundleSize;
      }
      return offerPrice ?? regularPrice ?? 0;
    }
    case 'loyalty': {
      if (offerPrice != null) return offerPrice;
      if (regularPrice != null && conditions.discountPercent != null) {
        return regularPrice * (1 - conditions.discountPercent / 100);
      }
      return regularPrice ?? 0;
    }
    case 'min_quantity':
    case 'price_drop':
    case 'cashback':
    default: {
      if (offerPrice != null) return offerPrice;
      if (regularPrice != null && conditions.discountPercent != null) {
        return regularPrice * (1 - conditions.discountPercent / 100);
      }
      return regularPrice ?? 0;
    }
  }
}

/** Beschrijft de aanbieding in het Nederlands, bv. "2 voor €5,00". */
export function offerLabel(kind: OfferKind, conditions: OfferConditions = {}, productName = ''): string {
  const parts: string[] = [];
  if (kind === 'multipack' || kind === 'bundle' || kind === 'per_volume') {
    if (conditions.bundleSize && conditions.bundlePrice != null) {
      const unit = conditions.bundleSize === 1 ? MONEY(conditions.bundlePrice) : `${conditions.bundleSize} voor ${MONEY(conditions.bundlePrice)}`;
      // "1+1 gratis" is in feite 2 voor 1x de prijs.
      if (conditions.bundleSize === 2 && conditions.bundlePrice === undefined) parts.push('1+1 gratis');
      else parts.push(unit);
    }
  }
  if (kind === 'second_half') {
    const discount = conditions.secondUnitDiscount ?? 0.5;
    parts.push(discount === 0.5 ? '2e halve prijs' : `2e ${Math.round(discount * 100)}% korting`);
  }
  if (kind === 'loyalty') {
    if (conditions.discountPercent != null) {
      parts.push(`${conditions.discountPercent}% met ${conditions.loyaltyCardName ?? 'klantenkaart'}`);
    } else if (conditions.requiresLoyaltyCard) {
      // Zonder dit blijft er "Actieprijs" staan, terwijl de prijs alleen met een
      // kaart geldt. Dat is precies het verschil dat je niet wilt ontdekken bij
      // de kassa, dus het hoort in het label naast het bedrag.
      parts.push(
        conditions.loyaltyCardName ? `Alleen met ${conditions.loyaltyCardName}` : 'Alleen met klantenkaart',
      );
    }
  }
  if (parts.length === 0) parts.push('Actieprijs');
  if (productName) return `${productName}: ${parts.join(' ')}`;
  return parts.join(' ');
}

/**
 * Berekent de volledige prijsinformatie voor een product bij een winkel.
 */
export function computeQuote(input: PricingInput): PriceQuote {
  const conditions = input.conditions ?? {};
  const notices: string[] = [];
  const warnings: string[] = [];

  const regular = input.regularPrice ?? null;
  const hasCardPrice = input.offerPrice ?? null;

  // Basisprijs per verpakking zonder enige kaart/actievoorwaarde.
  const baseUnitPrice = regular ?? (input.kind === 'loyalty' ? null : hasCardPrice) ?? 0;

  // Prijs mét kaart: soms is de kaartprijs lager dan de actieprijs.
  const cardUnitPrice = conditions.requiresLoyaltyCard && regular != null && conditions.discountPercent != null
    ? regular * (1 - conditions.discountPercent / 100)
    : null;

  const bestUnitPrice = effectiveUnitPrice(input);

  // ---- Hoeveel verpakkingen zijn nodig om `requiredQuantity` te dekken? ----
  // `requiredQuantity` en `packQuantity` staan in hetzelfde dimensie-systeem,
  // dus delen door de verpakkingsgrootte werkt voor gram, milliliter én stuks.
  const required = input.requiredQuantity;
  const amountPerUnit = input.packQuantity;
  const packIsUsable =
    amountPerUnit != null &&
    amountPerUnit.dimension === required.dimension &&
    amountPerUnit.amount > 0;

  let packsNeeded: number;
  if (packIsUsable) {
    packsNeeded = required.amount / amountPerUnit.amount;
  } else if (required.dimension === 'count' || required.dimension === 'packaging') {
    // Zonder bekende verpakkingsgrootte: elk stuk is één eenheid.
    packsNeeded = required.originalAmount;
  } else {
    // Massa/volume zonder bekende verpakkingsgrootte: we nemen één verpakking
    // en zeggen het eerlijk tegen de gebruiker.
    packsNeeded = 1;
    notices.push('Verpakkingsgrootte onbekend: dit is de prijs per verpakking, niet per kilogram of liter.');
  }

  // Voorwaarden afronden.
  let packsToBuy = packsNeeded;
  if ((input.kind === 'multipack' || input.kind === 'bundle' || input.kind === 'per_volume') && conditions.bundleSize && conditions.bundleSize > 1) {
    packsToBuy = Math.ceil(packsNeeded / conditions.bundleSize) * conditions.bundleSize;
    notices.push(`Verkoop per ${conditions.bundleSize}; je koopt ${packsToBuy} om ${formatCount(packsNeeded)} nodig te hebben.`);
  } else if (input.kind === 'second_half') {
    packsToBuy = Math.ceil(packsNeeded / 2) * 2;
    notices.push('De korting geldt per tweetal; afwijkende aantallen worden naar boven afgerond.');
  }
  if (conditions.minQuantity && packsNeeded > 0) {
    packsToBuy = Math.max(packsToBuy, conditions.minQuantity);
    if (packsNeeded < conditions.minQuantity) {
      notices.push(`Minimaal ${formatCount(conditions.minQuantity)} per klant.`);
    }
  }

  const extraUnits = roundQuantity(Math.max(0, packsToBuy - packsNeeded), 3);

  // ---- Kosten ----
  let basketCost: number;
  if (input.kind === 'multipack' || input.kind === 'bundle' || input.kind === 'per_volume') {
    if (conditions.bundleSize && conditions.bundlePrice != null) {
      const bundles = Math.ceil(packsNeeded / conditions.bundleSize);
      basketCost = bundles * conditions.bundlePrice;
    } else {
      basketCost = packsToBuy * bestUnitPrice;
    }
  } else if (input.kind === 'second_half') {
    const base = input.offerPrice ?? regular ?? bestUnitPrice;
    const discount = conditions.secondUnitDiscount ?? 0.5;
    const pairs = Math.ceil(packsNeeded / 2);
    basketCost = pairs * (base + base * (1 - discount));
  } else if (conditions.instantSavings && baseUnitPrice > 0) {
    basketCost = packsToBuy * bestUnitPrice - conditions.instantSavings;
    if (basketCost < 0) basketCost = 0;
  } else {
    basketCost = packsToBuy * bestUnitPrice;
  }

  const referencePrice = baseUnitPrice;
  const savingsPerUnit = referencePrice != null ? roundQuantity(referencePrice - bestUnitPrice) : 0;
  const savingsPercent = referencePrice && referencePrice > 0 ? roundQuantity(savingsPerUnit / referencePrice, 4) : null;

  // Prijs zonder kaart.
  let unitPriceWithoutCard: number | null = null;
  let basketCostWithoutCard: number | null = null;
  if (cardUnitPrice != null) {
    unitPriceWithoutCard = baseUnitPrice;
    basketCostWithoutCard = packsToBuy * baseUnitPrice;
    notices.push(
      `Deze prijs geldt alleen met ${conditions.loyaltyCardName ?? 'een klantenkaart'}. Zonder kaart: ${MONEY(baseUnitPrice ?? 0)} per ${input.productName ? 'verpakking' : 'stuk'}.`,
    );
  }
  if (conditions.requiresLoyaltyCard && cardUnitPrice == null) {
    warnings.push('Actieprijs is gekoppeld aan een klantenkaart — controleer de voorwaarden.');
  }
  if (extraUnits > 0 && input.packQuantity) {
    notices.push(`Je krijgt ${formatCount(extraUnits)} extra mee door deze actie.`);
  }
  if (conditions.maxPerPerson != null) {
    warnings.push(`Limiet: maximaal ${conditions.maxPerPerson} per persoon.`);
  }
  if (conditions.giftValue) {
    notices.push('Bijbehorend cadeau bij deze actie.');
  }
  if (input.inStock === false) {
    warnings.push('Op dit moment niet op voorraad in deze winkel.');
  }

  const label = offerLabel(input.kind, conditions, input.productName ?? '');

  return {
    storeId: input.storeId,
    unitPrice: roundMoney(bestUnitPrice),
    unitPriceWithoutCard: unitPriceWithoutCard == null ? null : roundMoney(unitPriceWithoutCard),
    savingsPerUnit: roundMoney(savingsPerUnit),
    savingsPercent: savingsPercent && savingsPercent > 0 ? savingsPercent : null,
    basketCost: roundMoney(basketCost),
    basketCostWithoutCard: basketCostWithoutCard == null ? null : roundMoney(basketCostWithoutCard),
    extraUnits,
    label,
    notices,
    warnings,
    requiresCard: Boolean(conditions.requiresLoyaltyCard),
    amountPerUnit: amountPerUnit ?? null,
  };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(value);
}

/** Berekent de prijs per kg, per liter of per stuk, indien bekend. */
export function unitPriceBreakdown(quote: PriceQuote, packQuantity: Quantity | null | undefined): {
  perKg: number | null;
  perLiter: number | null;
  perPiece: number | null;
} {
  if (!packQuantity) {
    return { perKg: null, perLiter: null, perPiece: quote.unitPrice };
  }
  const perPiece = quote.unitPrice;
  if (packQuantity.dimension === 'mass') {
    const kg = packQuantity.amount / 1000;
    return { perKg: kg > 0 ? roundPrice(quote.unitPrice / kg) : null, perLiter: null, perPiece };
  }
  if (packQuantity.dimension === 'volume') {
    const liters = packQuantity.amount / 1000;
    return { perKg: null, perLiter: liters > 0 ? roundPrice(quote.unitPrice / liters) : null, perPiece };
  }
  return { perKg: null, perLiter: null, perPiece };
}

function roundPrice(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export { MONEY as formatOfferMoney };
