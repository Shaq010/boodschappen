/**
 * Optimalisatie van de totale boodschappenkosten.
 *
 * Twee vraagstukken worden beantwoord:
 *
 *  1. "Goedkoopste combinatie" — voor elk product kiezen we de winkel waar het
 *     product het goedkoopst is. Daarna groeperen we de producten per winkel.
 *
 *  2. "Zo min mogelijk winkels" — dezelfde optimalisatie, maar met een
 *     harde beperking op het aantal te bezoeken winkels. Dit is een
 *     set-cover-achtig probleem. Omdat er slechts vier winkels zijn, kunnen we
 *     ALLE combinaties (2^4 = 16) exact doorrekenen. Bij meer winkels schakelen
 *     we over op een exacte algoritme voor kleine aantallen en een
 *     goedgekeurde heuristiek (greedy) voor grotere aantallen.
 *
 * Belangrijk: producten zonder prijsinformatie worden NOEG meegerekend. Ze
 * komen in een aparte lijst terecht zodat de gebruiker ziet dat het totaal
 * onvolledig is.
 */

import { type Quantity, formatMoney, formatQuantity } from './units.js';
import type { PriceQuote } from './offers.js';

export interface OptimizableItem {
  id: string;
  name: string;
  quantity: Quantity;
  checked: boolean;
  /** Aanwezig in huis; telt niet mee in de kosten. */
  inPantry: boolean;
}

export interface ItemQuote {
  itemId: string;
  itemName: string;
  quantity: Quantity;
  storeId: string;
  quote: PriceQuote;
}

export interface StoreLine {
  storeId: string;
  itemCount: number;
  subtotal: number;
  items: Array<{ itemId: string; itemName: string; cost: number; quantity: string; label: string; warnings: string[] }>;
}

export interface StorePlan {
  key: string;
  title: string;
  description: string;
  total: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  lines: StoreLine[];
  storeIds: string[];
  isComplete: boolean;
  missingItems: string[];
}

export interface OptimizationResult {
  /** Eén regel per winkel: alles daar kopen. */
  perStore: StorePlan[];
  /** Goedkoopste plan dat volledig bij één winkel te krijgen is. */
  cheapestSingleStore: StorePlan | null;
  cheapestSingleStoreTotal: number;
  /** Goedkoopste combinatie over alle winkels. */
  cheapestCombination: StorePlan;
  /** Goedkoopste oplossing met zo weinig mogelijk winkels. */
  minimalStores: StorePlan;
  /** Totaal van de goedkoopste combinatie. */
  cheapestTotal: number;
  /** Totaal van "zo min mogelijk winkels". */
  minimalStoresTotal: number;
  /** Duurste van de "alles bij één winkel"-opties. */
  mostExpensiveTotal: number;
  /** Besparing ten opzichte van de duurste optie (positief = bespaard). */
  savingsVsMostExpensive: number;
  /** Aantal producten zonder prijsinformatie. */
  unpriced: Array<{ itemId: string; name: string; reason: string }>;
  totalPricedItems: number;
  totalUnpricedItems: number;
  /** Of er voldoende prijsdata is om een betrouwbaar totaal te berekenen. */
  hasCompletePricing: boolean;
}

export interface OptimizeOptions {
  storeOrder?: string[];
  storeTitles?: Record<string, string>;
  /** Limiet voor de exacte algoritmes. */
  exactEnumerationLimit?: number;
  /** Als true: producten met een aanbieding die een klantenkaart vereisen tellen
   *  mee tegen hun reguliere prijs zodat de vergelijking eerlijk is. */
  excludeCardOnlyDeals?: boolean;
}

const DEFAULT_EXACT_LIMIT = 14;

export function optimize(
  items: readonly OptimizableItem[],
  quotes: readonly ItemQuote[],
  options: OptimizeOptions = {},
): OptimizationResult {
  const exactLimit = options.exactEnumerationLimit ?? DEFAULT_EXACT_LIMIT;
  const storeTitles = options.storeTitles ?? {};

  const active = items.filter((item) => !item.inPantry);
  const activeIds = new Set(active.map((item) => item.id));

  // Per item de beste quote per winkel.
  const bestByItem = new Map<string, Map<string, ItemQuote>>();
  for (const quote of quotes) {
    if (!activeIds.has(quote.itemId)) continue;
    if (options.excludeCardOnlyDeals && quote.quote.requiresCard) continue;
    const perStore = bestByItem.get(quote.itemId) ?? new Map<string, ItemQuote>();
    const existing = perStore.get(quote.storeId);
    if (!existing || quote.quote.basketCost < existing.quote.basketCost) {
      perStore.set(quote.storeId, quote);
    }
    bestByItem.set(quote.itemId, perStore);
  }

  const unpriced = active
    .filter((item) => (bestByItem.get(item.id)?.size ?? 0) === 0)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      reason: quotes.length === 0 ? 'Er zijn nog geen prijzen beschikbaar' : 'Geen van de winkels heeft dit product in het assortiment',
    }));

  const availableStores = [...new Set([...bestByItem.values()].flatMap((map) => [...map.keys()]))]
    .filter((storeId) => bestByItemHasStore(bestByItem, storeId))
    .sort((a, b) => {
      const order = options.storeOrder ?? [];
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

  // ---- "Alles bij één winkel" ----
  const perStore: StorePlan[] = availableStores.map((storeId) =>
    buildPlan(
      `store:${storeId}`,
      `Alles bij ${storeTitles[storeId] ?? storeId}`,
      `Alle ${active.length} producten in één winkel.`,
      active,
      bestByItem,
      unpriced,
      [storeId],
      storeTitles,
    ),
  );

  // ---- Goedkoopste combinatie over alle winkels ----
  const cheapestPlan = buildPlan(
    'combo:all',
    'Goedkoopste combinatie',
    'Elk product bij de winkel waar het het goedkoopst is.',
    active,
    bestByItem,
    unpriced,
    availableStores,
    storeTitles,
  );

  // ---- Zo min mogelijk winkels ----
  const minimalPlan = solveMinimalStores(active, bestByItem, unpriced, availableStores, storeTitles, exactLimit);

  // "Alles bij één winkel" is alleen een geldige optie als die winkel ook echt
  // alles heeft. Onvolledige plannen tellen daarom niet mee in de vergelijking.
  const completePlans = perStore.filter((plan) => plan.isComplete);
  const allTotals = completePlans.map((plan) => plan.total);
  const mostExpensiveTotal = allTotals.length > 0 ? Math.max(...allTotals) : 0;
  const cheapestSingleStore =
    completePlans.length > 0 ? completePlans.reduce((best, plan) => (plan.total < best.total ? plan : best)) : null;
  const referenceTotal = cheapestPlan.total;
  const totalPricedItems = active.length - unpriced.length;

  return {
    perStore,
    cheapestSingleStore,
    cheapestSingleStoreTotal: cheapestSingleStore?.total ?? 0,
    cheapestCombination: cheapestPlan,
    minimalStores: minimalPlan,
    cheapestTotal: referenceTotal,
    minimalStoresTotal: minimalPlan.total,
    mostExpensiveTotal,
    savingsVsMostExpensive: round2(Math.max(0, mostExpensiveTotal - referenceTotal)),
    unpriced,
    totalPricedItems,
    totalUnpricedItems: unpriced.length,
    hasCompletePricing: unpriced.length === 0,
  };
}

function bestByItemHasStore(bestByItem: Map<string, Map<string, ItemQuote>>, storeId: string): boolean {
  for (const perStore of bestByItem.values()) {
    if (perStore.has(storeId)) return true;
  }
  return false;
}

function buildPlan(
  key: string,
  title: string,
  description: string,
  activeItems: readonly OptimizableItem[],
  bestByItem: Map<string, Map<string, ItemQuote>>,
  unpriced: Array<{ itemId: string; name: string; reason: string }>,
  allowedStores: readonly string[],
  storeTitles: Record<string, string>,
): StorePlan {
  const byStore = new Map<string, StoreLine>();
  const missingItems: string[] = [];
  // Bij "zo min mogelijk winkels" is de verzameling toegestane winkels een
  // harde beperking: buiten die verzameling kiezen mag NIET.
  const allowed = new Set(allowedStores);

  for (const item of activeItems) {
    const perStore = bestByItem.get(item.id);
    if (!perStore || perStore.size === 0) {
      missingItems.push(item.name);
      continue;
    }

    const candidates = [...perStore.values()].filter((quote) => allowed.has(quote.storeId));
    if (candidates.length === 0) {
      missingItems.push(item.name);
      continue;
    }

    const chosen = candidates.reduce((best, current) =>
      current.quote.basketCost < best.quote.basketCost ? current : best,
    );

    const line = byStore.get(chosen.storeId) ?? {
      storeId: chosen.storeId,
      itemCount: 0,
      subtotal: 0,
      items: [],
    };
    line.itemCount += 1;
    line.subtotal = round2(line.subtotal + chosen.quote.basketCost);
    line.items.push({
      itemId: item.id,
      itemName: item.name,
      cost: chosen.quote.basketCost,
      quantity: formatQuantity(item.quantity),
      label: chosen.quote.label,
      warnings: [...chosen.quote.warnings, ...chosen.quote.notices.filter((n) => n.toLowerCase().includes('kaart'))],
    });
    byStore.set(chosen.storeId, line);
  }

  const lines = [...byStore.values()].sort((a, b) => b.subtotal - a.subtotal);
  const total = round2(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const usedStores = lines.map((line) => line.storeId);

  return {
    key,
    title,
    description,
    total,
    pricedItemCount: lines.reduce((sum, line) => sum + line.itemCount, 0),
    unpricedItemCount: unpriced.length + missingItems.length,
    lines,
    storeIds: usedStores,
    isComplete: missingItems.length === 0,
    missingItems,
  };
}

/**
 * Zoekt de oplossing met zo weinig mogelijk winkels.
 *
 * Leeswijze: eerst minimaliseren we het AANTAL winkels, en pas daarna de kosten.
 * Zo krijgt de gebruiker echt "ik wil zo min mogelijk rijden" in plaats van
 * opnieuw de goedkoopste combinatie. De goedkoopste combinatie staat er altijd
 * naast, dus er gaat niets verloren.
 *
 * Met vier winkels kunnen we alle 2^4 = 16 deelverzamelingen exact doorrekenen.
 * Bij meer winkels schakelen we over op een greedy-algoritme.
 */
function solveMinimalStores(
  activeItems: readonly OptimizableItem[],
  bestByItem: Map<string, Map<string, ItemQuote>>,
  unpriced: Array<{ itemId: string; name: string; reason: string }>,
  stores: readonly string[],
  storeTitles: Record<string, string>,
  exactLimit: number,
): StorePlan {
  if (stores.length === 0) {
    return buildPlan('combo:minimal', 'Zo min mogelijk winkels', 'Geen winkels met prijsdata beschikbaar.', activeItems, bestByItem, unpriced, [], storeTitles);
  }

  if (stores.length <= exactLimit) {
    // Exact: alle niet-lege deelverzamelingen doorrekenen en vergelijken op
    // (aantal winkels, kosten), in die volgorde.
    //
    // Alleen deelverzamelingen waarin élk product verkrijgbaar is komen in
    // aanmerking. Anders zou een winkel waarvan het assortiment onvolledig is
    // ten onrechte als "goedkoopst" uit de bus komen, omdat de ontbrekende
    // producten dan gewoon niet meegerekend worden.
    let bestSubset: string[] | null = null;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let mask = 1; mask < 2 ** stores.length; mask += 1) {
      const subset: string[] = [];
      for (let i = 0; i < stores.length; i += 1) {
        if (mask & (1 << i)) subset.push(stores[i]!);
      }
      // Meer winkels dan de huidige beste oplossing kan nooit winnen.
      if (bestSubset && subset.length > bestSubset.length) continue;
      const evaluated = costForSubset(activeItems, bestByItem, subset);
      if (!evaluated.feasible) continue;
      if (bestSubset === null || subset.length < bestSubset.length || evaluated.cost < bestCost - 0.005) {
        bestCost = evaluated.cost;
        bestSubset = subset;
      }
    }

    if (bestSubset === null) {
      // Geen enkele winkelselectie is compleet: val terug op alle winkels.
      return buildPlan(
        'combo:minimal',
        'Zo min mogelijk winkels',
        'Geen winkelselectie bevat de volledige lijst; hieronder het plan over alle winkels.',
        activeItems,
        bestByItem,
        unpriced,
        stores,
        storeTitles,
      );
    }

    const subset = bestSubset;
    return buildPlan(
      'combo:minimal',
      'Zo min mogelijk winkels',
      `Goedkoopste oplossing binnen ${subset.length} ${subset.length === 1 ? 'winkel' : 'winkels'}.`,
      activeItems,
      bestByItem,
      unpriced,
      subset,
      storeTitles,
    );
  }

  // Heuristiek voor veel winkels: begin met de winkel die het meeste dekt en
  // voeg winkels toe zolang dat extra winkels echt nodig zijn.
  const feasible = (subset: readonly string[]): boolean => costForSubset(activeItems, bestByItem, subset).feasible;

  // Zo klein mogelijke haalbare subset: probeer 1 winkel, dan 2, enzovoort.
  let chosen: string[] = stores.filter((storeId) => feasible([storeId]));
  if (chosen.length === 0) {
    let found: string[] | null = null;
    for (let size = 2; size <= stores.length && found === null; size += 1) {
      const combination: string[] = [];
      const recurse = (start: number): void => {
        if (found) return;
        if (combination.length === size) {
          if (feasible(combination)) found = [...combination];
          return;
        }
        for (let i = start; i < stores.length; i += 1) {
          combination.push(stores[i]!);
          recurse(i + 1);
          combination.pop();
          if (found) return;
        }
      };
      recurse(0);
    }
    chosen = found ?? [...stores];
  }

  // Binnen de gekozen winkels het goedkoopst maken.
  const greedy = new Set(chosen);
  const current = costForSubset(activeItems, bestByItem, [...greedy]).cost;
  let improved = true;
  while (improved && greedy.size < stores.length) {
    improved = false;
    let bestAdd: { storeId: string; cost: number } | null = null;
    for (const storeId of stores) {
      if (greedy.has(storeId)) continue;
      const trial = new Set([...greedy, storeId]);
      const cost = costForSubset(activeItems, bestByItem, [...trial]).cost;
      if (cost < current - 0.005 && (bestAdd === null || cost < bestAdd.cost)) {
        bestAdd = { storeId, cost };
      }
    }
    if (bestAdd) {
      greedy.add(bestAdd.storeId);
      improved = true;
    }
  }

  return buildPlan(
    'combo:minimal',
    'Zo min mogelijk winkels',
    `Beste oplossing met ${greedy.size} ${greedy.size === 1 ? 'winkel' : 'winkels'}.`,
    activeItems,
    bestByItem,
    unpriced,
    [...greedy],
    storeTitles,
  );
}

function costForSubset(
  activeItems: readonly OptimizableItem[],
  bestByItem: Map<string, Map<string, ItemQuote>>,
  subset: readonly string[],
): { cost: number; unpriced: string[]; feasible: boolean } {
  const subsetSet = new Set(subset);
  let cost = 0;
  const unpriced: string[] = [];

  for (const item of activeItems) {
    const perStore = bestByItem.get(item.id);
    if (!perStore) {
      unpriced.push(item.name);
      continue;
    }
    let best: ItemQuote | null = null;
    for (const [storeId, quote] of perStore) {
      if (!subsetSet.has(storeId)) continue;
      if (!best || quote.quote.basketCost < best.quote.basketCost) best = quote;
    }
    if (best) cost += best.quote.basketCost;
    else unpriced.push(item.name);
  }

  return { cost: round2(cost), unpriced, feasible: unpriced.length === 0 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatTotal(value: number): string {
  return formatMoney(value);
}
