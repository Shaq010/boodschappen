/**
 * Drankherkenning.
 *
 * De app heeft een eigen "Drankaanbiedingen"-scherm. Om dat te vullen moet de
 * app kunnen bepalen welke producten dranken zijn. Deze module doet dat op
 * basis van categorie (uit de database), maar ook op basis van de productnaam
 * zelf, zodat het ook werkt voor producten die nog geen categorie hebben.
 */

import { normalizeName } from './normalize.js';

export type DrinkKind = 'frisdrank' | 'water' | 'sap' | 'energie' | 'bier' | 'wijn' | 'sterkedrank' | 'koffie-thee' | 'overig';

export const DRINK_KIND_LABELS: Record<DrinkKind, string> = {
  frisdrank: 'Frisdrank',
  water: 'Water',
  sap: 'Sap & Jus',
  energie: 'Energie- & sportdrank',
  bier: 'Bier',
  wijn: 'Wijn',
  sterkedrank: 'Sterke drank',
  'koffie-thee': 'Koffie & thee',
  overig: 'Melk & overige dranken',
};

const DRINK_KEYWORDS: ReadonlyArray<readonly [DrinkKind, readonly string[]]> = [
  ['energie', ['energy', 'red bull', 'redbull', 'burn', 'monster', 'isotonic', 'sportdrank', 'aa drink']],
  ['water', ['water', 'spa', 'spa rood', 'spa blauw', 'spa groen', 'spaarwater', 'still', 'sparrow', 'aqua', 'barriere', 'chaufon', 'dubbel fris', 'slo', 'still water', 'kraanwater', 'water fles', 'waterfles', 'bronwater', 'mineral water', 'spaar water', 'spar', 'double cola']],
  ['sap', ['sap', 'jus', 'sinaasappelsap', 'appelsap', 'troebel', 'vruchtensap', 'smoothie', 'grenadine', 'rozen', 'fruitdrank']],
  ['bier', ['bier', 'pils', 'pilsner', 'pilsener', 'lager', 'ale', 'stout', 'witbier', 'amstel', 'heineken', 'grolsch', 'jopen', 'brand', 'tap', 'radler', 'blond', 'bavaria', 'carlsberg', 'budweiser', 'leffe', 'desperados', 'corona', 'chouffe']],
  ['wijn', ['wijn', 'rode wijn', 'witte wijn', 'rose', 'rosé', 'pinot', 'chardonnay', 'merlot', 'cabernet', 'sauvignon', 'prosecco', 'cava', 'rioja', 'bordeaux', 'chablis', 'asti', 'frizzante', 'honingwijn', 'wijnfris']],
  ['sterkedrank', ['whisky', 'wodka', 'rum', 'gin', 'likeur', 'jenever', 'borrel', 'sterkedrank', 'advocaat', 'port', 'sherry', 'vermouth', 'likeuren', 'jagermeister', 'bacardi']],
  ['overig', ['melk', 'volle melk', 'halfvolle melk', 'magere melk', 'karnemelk', 'sojamelk', 'havermelk', 'drinkmelk', 'melkbeverage', 'karnemelk', 'melkchocolade', 'chocomelk', 'melkproduct']],
  ['koffie-thee', ['koffie', 'espresso', 'cappuccino', 'latte', 'koffiebonen', 'gemalen koffie', 'filterkoffie', 'thee', 'theebladeren', 'groene thee', 'zwarte thee', 'kruidenthee', 'ice tea', 'icetea', 'chai', 'matcha', 'chocomelk', 'chocolademelk', 'warme chocolademelk']],
  // Melkproducten zijn in Nederland een van de grootste drankcategorieën.
  // Ze staan qua categorie onder zuivel, maar voor de Drankaanbiedingen
  // zijn ze zeker relevant.
  ['overig', ['melk', 'volle melk', 'halfvolle melk', 'magere melk', 'karnemelk', 'sojamelk', 'havermelk', 'drinkmelk', 'melkproduct', 'melkbeverage']],
  ['frisdrank', ['cola', 'coca cola', 'coca-cola', 'coke', 'fanta', 'sprite', '7up', '7 up', 'pepsi', 'schweppes', 'chocomel', 'rivella', 'faygo', 'dubbel fris', 'limonade', 'soda', 'tonic', 'bitter', 'gaseosa', 'pipi', 'sinalco', 'royal club', 'fuze tea', 'ice tea', 'orangina', 'red bull', 'ayran', 'cactus', 'fruitsap', 'gomboy', 'bollymets', 'chocomel', 'van dijks', 'van d ijks', 'dubbelfris', 'coca cola zero', 'coca cola light', 'mountain dew', 'gatorade', 'rappi', 'timpo']],
];

/** Extra expliciete woordenlijst voor dranken die vaak fout worden herkend. */
const EXTRA_KEYWORDS: ReadonlyArray<readonly [DrinkKind, readonly string[]]> = [
  ['frisdrank', ['cola', 'coca cola', 'coca-cola', 'cocacola', 'coke', 'cola zero', 'cola light', 'fanta', 'sprite', 'pepsi', 'mountain dew', 'gatorade', 'royal club', 'faygo', 'sinalco', 'pipi', 'pipi limonade', 'spar', 'dubbelfris', 'chocomel', 'rivella', 'schweppes', 'orangina', '7up', 'seven up', 'ice tea', 'icetea', 'lipton ice', 'gibson', 'gummie', 'ayran', 'coca-cola zero sugar', 'coca cola zero sugar']],
  ['water', ['water', 'spa', 'spa rood', 'spa blauw', 'spa groen', 'spa mineraal', 'barriere', 'spar', 'spar magnesia', 'chaufon', 'aqua', 'still water', 'sour water', 'mineral water', 'dubbel fris', 'double cola', 'water fles', 'waterfles']],
  ['frisdrank', ['capri sun', 'caprisun', 'capri-sun', 'funki', 'mio', 'kruidengas', 'chupa chups', 'chupachups', 'solar', 'gaseosa', 'limonade', 'orangina', '7up', 'seven up', 'ice tea', 'icetea', 'lipton ice', 'schweppes', 'pipi limonade', 'slo', 'sinalco']],
  ['sap', ['sap', 'jus', 'jus d orange', 'appelsap', 'troebel sap', 'vruchtensap', 'sinaasappelsap', 'greengroentesap', 'smoothie', 'knijpesap', 'limonade sinaasappel']],
];

/** Woorden die NIET als drank mogen gelden, ondanks overlap. */
const NEGATIVE_KEYWORDS = ['waterval', 'waterscheiding', 'watervallei'];

export function classifyDrink(name: string): DrinkKind | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  if (NEGATIVE_KEYWORDS.some((word) => normalized.includes(word))) return null;

  let best: { kind: DrinkKind; length: number } | null = null;
  for (const [kind, keywords] of [...EXTRA_KEYWORDS, ...DRINK_KEYWORDS]) {
    for (const keyword of keywords) {
      const key = normalizeName(keyword);
      if (!key) continue;
      const matches =
        normalized === key ||
        normalized.split(' ').includes(key) ||
        new RegExp(`\\b${escapeRegex(key)}\\b`).test(normalized);
      if (!matches) continue;
      if (!best || key.length > best.length) best = { kind, length: key.length };
    }
  }
  return best?.kind ?? null;
}

export function isDrink(name: string): boolean {
  return classifyDrink(name) !== null;
}

/** Groepeert een lijst producten in dranken en overige producten. */
export function partitionDrinks<T extends { name: string }>(products: readonly T[]): { drinks: T[]; others: T[] } {
  const drinks: T[] = [];
  const others: T[] = [];
  for (const product of products) {
    if (isDrink(product.name)) drinks.push(product);
    else others.push(product);
  }
  return { drinks, others };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bekende drankproducten waar de gebruiker vaak naar zoekt. */
export const COMMON_DRINK_KEYWORDS: readonly string[] = [
  'cola', 'coca cola', 'coca-cola', 'fanta', 'sprite', 'pepsi', 'water', 'spa',
  'sap', 'jus', 'bier', 'wijn', 'koffie', 'thee', 'chocomel', 'dubbel fris',
  'red bull', 'rivella', 'capri sun', 'caprisun', 'fuze tea', 'gatorade', 'water fles',
];
