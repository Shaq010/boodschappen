/**
 * Eenhedenstelsel voor de boodschappen-app.
 *
 * Ontwerpprincipes:
 *  - Elke eenheid hoort bij precies één dimensie (massa, volume, aantal, verpakking).
 *  - Massa heeft basiseenheid gram, volume milliliter, aantal stuks.
 *  - Verpakkingseenheden (pak, fles, blik ...) zijn NIET naar elkaar om te rekenen:
 *    het zijn containers, geen maateenheden. Alleen als het product een bekend
 *    gewicht per verpakking heeft, kan een schatting worden gemaakt.
 *  - Combinatie van hoeveelheden is alleen geldig binnen dezelfde dimensie.
 */

export type UnitDimension = 'mass' | 'volume' | 'count' | 'packaging';

export interface UnitDef {
  /** Canonieke code zoals gebruikt in de database. */
  code: string;
  dimension: UnitDimension;
  /** Aantal basiseenheden per 1 van deze eenheid. */
  baseFactor: number;
  /** Enkelvoud in het Nederlands, bv. 'gram'. */
  label: string;
  /** Meervoud in het Nederlands, bv. 'pakken'. */
  labelPlural: string;
  /** Verkorte weergave voor compacte lijsten, bv. 'kg'. */
  short: string;
  /** Invoerschrijfwijzen die de gebruiker kan typen. */
  aliases: readonly string[];
  /** Mag deze eenheid automatisch uit vrije tekst worden gehaald? */
  autoParse: boolean;
}

function def(
  code: string,
  dimension: UnitDimension,
  baseFactor: number,
  label: string,
  labelPlural: string,
  short: string,
  aliases: readonly string[],
  autoParse = true,
): UnitDef {
  return { code, dimension, baseFactor, label, labelPlural, short, aliases, autoParse };
}

export const UNITS: readonly UnitDef[] = [
  // ---- massa (basiseenheid: gram) ----
  // Nederlands: 1 kilogram, 2 kilogram (niet "kilograms")
  def('mg', 'mass', 0.001, 'milligram', 'milligrammen', 'mg', ['mg', 'milligram', 'milligrammen']),
  def('g', 'mass', 1, 'gram', 'gram', 'g', ['g', 'gram', 'gr', 'gm', 'grammen']),
  def('kg', 'mass', 1000, 'kilogram', 'kilogram', 'kg', ['kg', 'kilo', 'kilogram', 'kilogrammen', 'kgs']),
  def('ons', 'mass', 100, 'ons', 'ons', 'ons', ['ons', 'onsen'], false),

  // ---- volume (basiseenheid: milliliter) ----
  def('ml', 'volume', 1, 'milliliter', 'milliliter', 'ml', ['ml', 'milliliter', 'milliliters']),
  def('cl', 'volume', 10, 'centiliter', 'centiliter', 'cl', ['cl', 'centiliter', 'centiliters']),
  def('dl', 'volume', 100, 'deciliter', 'deciliter', 'dl', ['dl', 'deciliter', 'deciliters']),
  def('l', 'volume', 1000, 'liter', 'liter', 'l', ['l', 'liter', 'liters', 'litre', 'litres']),

  // ---- aantal (basiseenheid: stuk) ----
  def('st', 'count', 1, 'stuk', 'stuks', 'st', [
    'st', 'stuk', 'stuks', 'stukje', 'stukjes', 'stk', 'ea', 'e',
  ]),

  // ---- verpakkingen (niet onderling converteerbaar) ----
  def('pak', 'packaging', 1, 'pak', 'pakken', 'pak', ['pak', 'paks', 'pakje', 'pakjes']),
  def('fles', 'packaging', 1, 'fles', 'flessen', 'fles', ['fles', 'flessen', 'flesje', 'flesjes', 'flacon', 'flacons']),
  def('blik', 'packaging', 1, 'blik', 'blikken', 'blik', ['blik', 'blikken', 'blikje', 'blikjes', 'busje', 'busjes']),
  def('doos', 'packaging', 1, 'doos', 'dozen', 'doos', ['doos', 'dozen', 'doosje', 'doosjes', 'kist', 'kisten', 'kistje']),
  def('zak', 'packaging', 1, 'zak', 'zakken', 'zak', ['zak', 'zakken', 'zakje', 'zakjes']),
  def('pot', 'packaging', 1, 'pot', 'potten', 'pot', ['pot', 'potten', 'potje', 'potjes', 'kuip', 'kuipjes', 'bak', 'bakje', 'bakjes']),
  def('strip', 'packaging', 1, 'strip', 'strips', 'strip', ['strip', 'strips', 'stripje', 'blister', 'blisters']),
  def('tablet', 'packaging', 1, 'tablet', 'tablets', 'tablet', ['tablet', 'tablets']),
  def('bundel', 'packaging', 1, 'bundel', 'bundels', 'bundel', ['bundel', 'bundels', 'bos', 'bossen']),
  def('tray', 'packaging', 1, 'tray', 'trays', 'tray', ['tray', 'trays', 'verpakkingseenheid']),
  def('portie', 'packaging', 1, 'portie', 'porties', 'portie', ['portie', 'porties', 'servoir', 'serving', 'servings'], false),
] as const;

const BY_CODE = new Map<string, UnitDef>(UNITS.map((u) => [u.code, u]));

/**
 * Index van invoerschrijfwijze -> canonieke code.
 * Bij conflicten wint de eerste ingang in de volgorde van UNITS.
 */
const BY_ALIAS = new Map<string, string>();
for (const unit of UNITS) {
  for (const alias of unit.aliases) {
    if (!BY_ALIAS.has(alias)) BY_ALIAS.set(alias, unit.code);
  }
}

export const BASE_UNIT: Record<UnitDimension, string> = {
  mass: 'g',
  volume: 'ml',
  count: 'st',
  packaging: 'pak',
};

export function getUnit(code: string | null | undefined): UnitDef | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

export function getUnitByAlias(alias: string): UnitDef | null {
  const code = BY_ALIAS.get(alias.toLowerCase());
  return code ? BY_CODE.get(code) ?? null : null;
}

export function isUnitCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function isUnitAlias(alias: string): boolean {
  return BY_ALIAS.has(alias.toLowerCase());
}

export function unitsOfDimension(dimension: UnitDimension): UnitDef[] {
  return UNITS.filter((u) => u.dimension === dimension);
}

/** Alle eenheden die de gebruiker vrij in tekst mag typen. */
export function autoParseableUnits(): UnitDef[] {
  return UNITS.filter((u) => u.autoParse);
}

// ---------------------------------------------------------------------------
// Hoeveelheden
// ---------------------------------------------------------------------------

/**
 * Een gemeten hoeveelheid product. `amount` is altijd uitgedrukt in de
 * basiseenheid van de dimensie (g, ml, st, of het aantal verpakkingen).
 */
export interface Quantity {
  dimension: UnitDimension;
  /** Aantal basiseenheden, bv. 1500 bij 1,5 kg. */
  amount: number;
  /** De eenheid zoals de gebruiker die noemde; kan `st` zijn bij kale tellingen. */
  unit: string;
  /** De oorspronkelijke eenheidscode voordat er geconverteerd werd. */
  originalUnit: string;
  /** Oorspronkelijke hoeveelheid zoals getypt. */
  originalAmount: number;
}

export function makeQuantity(amount: number, unitCode: string): Quantity {
  const unit = getUnit(unitCode);
  if (!unit) throw new Error(`Onbekende eenheid: ${unitCode}`);
  return {
    dimension: unit.dimension,
    amount: roundQuantity(amount * unit.baseFactor),
    unit: unit.dimension === 'packaging' ? unit.code : unit.dimension === 'count' ? 'st' : BASE_UNIT[unit.dimension],
    originalUnit: unit.code,
    originalAmount: amount,
  };
}

/** Identiteit voor producten zonder opgegeven eenheid. */
export function defaultQuantity(amount = 1): Quantity {
  return makeQuantity(amount, 'st');
}

/** Bedragen in euro's worden afgerond op centen, zoals bij een kassa. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundQuantity(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Converteer een hoeveelheid naar een andere eenheid van dezelfde dimensie.
 */
export function convertQuantity(qty: Quantity, targetCode: string): Quantity | null {
  const target = getUnit(targetCode);
  if (!target || target.dimension !== qty.dimension) return null;
  return {
    dimension: qty.dimension,
    amount: roundQuantity(qty.amount / target.baseFactor),
    unit: target.code,
    originalUnit: target.code,
    originalAmount: roundQuantity(qty.amount / target.baseFactor),
  };
}

export type CombineResult =
  | { ok: true; quantity: Quantity }
  | { ok: false; reason: 'dimension-conflict'; a: Quantity; b: Quantity };

/**
 * Tel twee hoeveelheden op. Alleen mogelijk binnen dezelfde dimensie;
 * anders wordt expliciet een conflict teruggegeven zodat de gebruiker kan kiezen.
 */
export function combineQuantities(a: Quantity, b: Quantity): CombineResult {
  if (a.dimension !== b.dimension) {
    return { ok: false, reason: 'dimension-conflict', a, b };
  }
  // Verpakkingen hebben geen uniforme maat; toon ze in de eenheid die de
  // gebruiker het vaakst noemde, maar tel de aantallen gewoon op.
  const unit = a.dimension === 'packaging' ? a.originalUnit : a.unit;
  const target = getUnit(unit) ?? getUnit(BASE_UNIT[a.dimension]);
  const combined = makeQuantity((a.amount + b.amount) / (target?.baseFactor ?? 1), target?.code ?? a.unit);
  return { ok: true, quantity: combined };
}

// ---------------------------------------------------------------------------
// Weergave
// ---------------------------------------------------------------------------

const NL_NUMBER = new Intl.NumberFormat('nl-NL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const NL_MONEY = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NL_MONEY_PRECISE = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatNumber(value: number): string {
  return NL_NUMBER.format(value);
}

export function formatMoney(value: number): string {
  return NL_MONEY.format(value);
}

export function formatMoneyPrecise(value: number): string {
  return NL_MONEY_PRECISE.format(value);
}

export function formatPercent(fraction: number): string {
  return `${NL_NUMBER.format(Math.round(fraction * 1000) / 10)}%`;
}

/** Kiest de prettigste eenheid: 1500 g wordt 1,5 kg, 2000 ml wordt 2 l. */
export function humanizeQuantity(qty: Quantity): { amount: number; unit: UnitDef } {
  const unit = getUnit(qty.originalUnit) ?? getUnit(qty.unit) ?? getUnit('st');
  if (!unit) return { amount: qty.amount, unit: getUnit('st')! };

  if (unit.dimension === 'mass' && qty.amount >= 1000) {
    return { amount: roundQuantity(qty.amount / 1000, 3), unit: getUnit('kg')! };
  }
  if (unit.dimension === 'volume' && qty.amount >= 1000) {
    return { amount: roundQuantity(qty.amount / 1000, 3), unit: getUnit('l')! };
  }
  if (unit.dimension === 'count' && qty.amount >= 1) {
    return { amount: roundQuantity(qty.amount, 3), unit: getUnit('st')! };
  }
  return { amount: roundQuantity(qty.amount, 3), unit };
}

/** "1,5 kg", "6 st", "2 pak" — klaar voor gebruik in de interface. */
export function formatQuantity(qty: Quantity): string {
  const { amount, unit } = humanizeQuantity(qty);
  const label = amount === 1 ? unit.label : unit.labelPlural;
  return `${formatNumber(amount)} ${label}`;
}

export function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  return `${word}s`;
}
