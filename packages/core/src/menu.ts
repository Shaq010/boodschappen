/**
 * Weekmenu: dagen, maaltijden en ingrediënten, en het automatisch samenstellen
 * van een gecombineerde boodschappenlijst uit het weekmenu.
 *
 * Het lastige deel is het samenvoegen: hetzelfde ingrediënt kan in verschillende
 * maaltijden voorkomen met verschillende eenheden ("500 g gehakt" en
 * "1 kg gehakt" -> "1,5 kg gehakt"). Als de eenheden niet combineerbaar zijn
 * (bv. "2 st gehakt" en "500 g gehakt") geven we een conflict terug in plaats
 * van stil te kiezen — de gebruiker kiest dan zelf.
 */

import { type CombineResult, type Quantity, combineQuantities, formatQuantity, makeQuantity, roundQuantity } from './units.js';
import { canonicalName, type SynonymIndex, buildSynonymIndex, inferCategory, type ProductCategory } from './normalize.js';

export const WEEKDAYS = [
  'maandag',
  'dinsdag',
  'woensdag',
  'donderdag',
  'vrijdag',
  'zaterdag',
  'zondag',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  maandag: 'Maandag',
  dinsdag: 'Dinsdag',
  woensdag: 'Woensdag',
  donderdag: 'Donderdag',
  vrijdag: 'Vrijdag',
  zaterdag: 'Zaterdag',
  zondag: 'Zondag',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  maandag: 'ma',
  dinsdag: 'di',
  woensdag: 'wo',
  donderdag: 'do',
  vrijdag: 'vr',
  zaterdag: 'za',
  zondag: 'zo',
};

export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

/** ISO-datum (YYYY-MM-DD) -> weekday-index, zonder tijdzone-drama. */
export function weekdayOfIsoDate(isoDate: string): Weekday | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // new Date(year, month, day) geeft de zondag op index 0; maandag op index 1.
  const jsIndex = date.getDay();
  const mondayBased = (jsIndex + 6) % 7;
  return WEEKDAYS[mondayBased] ?? null;
}

/** Startdatum (maandag) van de week waarin de gegeven datum valt. */
export function startOfIsoWeek(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const jsIndex = date.getDay();
  const offset = (jsIndex + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toIsoDate(date);
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Vandaag in Nederland (Europe/Amsterdam) als ISO-datum. */
export function todayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

export function currentWeekday(now: Date = new Date()): Weekday {
  return weekdayOfIsoDate(todayIso(now)) ?? 'maandag';
}

// ---------------------------------------------------------------------------
// Ingrediënten samenvoegen
// ---------------------------------------------------------------------------

export interface MergeableIngredient {
  id: string;
  name: string;
  quantity: Quantity;
  /** Optioneel: dit product is al in huis. */
  inPantry?: boolean;
  /** Alleen meenemen als dit product in huis staat. */
  onlyIfMissing?: boolean;
}

export interface MergedIngredient {
  /** Gecombineerde, canonieke naam. */
  name: string;
  quantity: Quantity;
  /** De bijdrages van de afzonderlijke maaltijden. */
  sources: Array<{ ingredientId: string; name: string; quantity: Quantity }>;
  category: ProductCategory;
  /** true wanneer dit product al in huis staat en dus niet gekocht hoeft te worden. */
  inPantry: boolean;
  conflict: boolean;
}

export interface MergeConflict {
  name: string;
  parts: Array<{ ingredientId: string; name: string; quantity: Quantity }>;
  message: string;
}

export interface MergeResult {
  merged: MergedIngredient[];
  conflicts: MergeConflict[];
}

function groupKey(name: string, index: SynonymIndex): string {
  return canonicalName(name, index);
}

/**
 * Voegt ingrediënten uit meerdere maaltijden samen tot één boodschappenlijst.
 */
export function mergeIngredients(
  ingredients: readonly MergeableIngredient[],
  index: SynonymIndex = buildSynonymIndex(),
): MergeResult {
  const groups = new Map<string, MergedIngredient>();

  for (const ingredient of ingredients) {
    const key = groupKey(ingredient.name, index);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        name: key,
        quantity: ingredient.quantity,
        sources: [{ ingredientId: ingredient.id, name: ingredient.name, quantity: ingredient.quantity }],
        category: inferCategory(key, index),
        inPantry: Boolean(ingredient.inPantry),
        conflict: false,
      });
      continue;
    }

    const combined = combineQuantities(existing.quantity, ingredient.quantity);
    if (combined.ok) {
      existing.quantity = combined.quantity;
      existing.sources.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: ingredient.quantity,
      });
      existing.inPantry = existing.inPantry && Boolean(ingredient.inPantry);
    } else {
      // Niet samen te voegen: markeer als conflict zodat de gebruiker kiest.
      existing.conflict = true;
      existing.sources.push({
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: ingredient.quantity,
      });
    }
  }

  const merged = [...groups.values()].map((entry) => {
    if (entry.conflict) return entry;
    return { ...entry, quantity: { ...entry.quantity } };
  });

  const conflicts: MergeConflict[] = merged
    .filter((entry) => entry.conflict)
    .map((entry) => ({
      name: entry.name,
      parts: entry.sources,
      message:
        `"${entry.name}" komt in het menu voor met verschillende eenheden ` +
        `(${entry.sources.map((s) => formatQuantity(s.quantity)).join(', ')}). ` +
        `Kies één eenheid om de hoeveelheid te bepalen.`,
    }));

  return { merged, conflicts };
}

/** Losse conflicted hoeveelheid: gebruik een opgegeven eenheid. */
export function resolveConflict(
  ingredient: MergeableIngredient,
  parts: readonly MergeableIngredient[],
  chosenUnit: string,
): Quantity {
  let total: Quantity | null = null;
  for (const part of parts) {
    const converted = convertTo(part.quantity, chosenUnit);
    if (!converted) continue;
    const result: CombineResult = total
      ? combineQuantities(total, converted)
      : { ok: true, quantity: converted };
    if (result.ok) total = result.quantity;
  }
  if (total) return total;
  return makeQuantity(parts.reduce((sum, p) => sum + p.quantity.originalAmount, 0), chosenUnit);
}

function convertTo(quantity: Quantity, unitCode: string): Quantity | null {
  const target = makeQuantity(1, unitCode);
  if (target.dimension !== quantity.dimension) return null;
  return makeQuantity(quantity.amount / target.amount, unitCode);
}

export { roundQuantity };
