/**
 * Slimme productherkenning.
 *
 * Doel: "cola", "Coca Cola" en "Coca-Cola" moeten waar mogelijk hetzelfde
 * product zijn, maar we mogen nooit twee verschillende producten ten onrechte
 * samenvoegen. Daarom werkt de herkenning met drie uitkomsten:
 *
 *   - `match`    (zekerheid >= AUTO_MATCH_THRESHOLD)  -> automatisch samenvoegen
 *   - `suggest`  (zekerheid >= SUGGEST_THRESHOLD)      -> gebruiker laten kiezen
 *   - `none`                                       -> niets doen
 *
 * Dit bestand bevat ALLEEN productnaamkennis (synoniemen, categorieën).
 * Er staan bewust GEEN prijzen of aanbiedingen in: die komen uit de databronnen.
 */

// ---------------------------------------------------------------------------
// Tekstnormalisatie
// ---------------------------------------------------------------------------

/** Verwijdert diacrieten: "knösel" -> "knosel", "crème" -> "creme". */
export function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Maakt een productnaam vergelijkbaar:
 * kleine letters, geen accenten, streepjes en punten worden spaties,
 * dubbele spaties verdwijnen.
 */
export function normalizeName(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/['`’]/g, '')
    .replace(/&/g, ' en ')
    .replace(/[-_.:/\\+]/g, ' ')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(name: string): string[] {
  const normalized = normalizeName(name);
  return normalized.length === 0 ? [] : normalized.split(' ');
}

/**
 * Woorden die de verpakking beschrijven, niet het product zelf.
 *
 * Winkelproducten heten bijna altijd volledig: "Melk 1 l", "Coca-Cola regular
 * 1,5 l", "Spaghetti 500 g". Wie zelf een lijstje typt, schrijft gewoon "melk" of
 * "cola". Zonder deze woorden weg te halen zouden die namen nooit op elkaar
 * lijken en zou de herkenning bijna altijd blijven hangen op "twijfel".
 */
const PACKAGING_TOKENS: ReadonlySet<string> = new Set([
  'fles', 'flesje', 'flessen', 'pak', 'pakje', 'pakken', 'zak', 'zakje', 'tray', 'trays',
  'doos', 'doosje', 'stuk', 'stuks', 'blik', 'pot', 'potje', 'bak', 'kuip', 'emmer',
  'can', 'bottle', 'pack', 'packs', 'st', 'stk', 'stks', 'x',
]);

/** Eenheden die in een productnaam als maat voorkomen ("1500 ml", "1,5 l"). */
const SIZE_UNIT_TOKENS: ReadonlySet<string> = new Set([
  'ml', 'cl', 'dl', 'l', 'kg', 'mg', 'g', 'cc', 'cm3', 'e', 'ltr', 'kilo', 'gram',
]);

/** Een los getal, met of without komma: "1", "12", "1,5", "2.5". */
const NUMBER_TOKEN = /^\d+([.,]\d+)?$/;

/**
 * Haalt maatvoering en verpakkingswoorden uit een productnaam.
 *
 * "Coca-Cola regular 1,5 l" -> "coca cola regular"
 * "Melk 1 l"               -> "melk"
 * "Spaghetti 500 g"        -> "spaghetti"
 *
 * Er blijft één ding bewust staan: het woord `x` in "12 x 1 l" verdwijnt, want
 * dat is verpakking. Getallen verdwijnen ook, want "Melk 1 l" en "Melk 3 l"
 * verschillen dan alleen nog in het packformaat, en dat hoort bij de prijs
 * (het productformaat) en niet bij de herkenning.
 */
export function productCoreName(name: string): string {
  const tokens = tokenize(name).filter((token) => {
    if (NUMBER_TOKEN.test(token)) return false;
    if (PACKAGING_TOKENS.has(token)) return false;
    if (SIZE_UNIT_TOKENS.has(token)) return false;
    return true;
  });
  return tokens.join(' ');
}

/** Is de kernnaam bruikbaar, dus niet leeggevallen op verpakking ("1 l")? */
function hasUsableCore(name: string): boolean {
  return productCoreName(name).length > 0;
}

/**
 * De packvorm, als losse handtekening: "Melk 1 l" -> "1l", "Spaghetti 500 g" -> "500g".
 *
 * De kernnaam gooit de maatvoering weg, maar die is wel nodig om "Melk 1 l" en
 * "Melk 3 l" van elkaar te onderscheiden. Met deze handtekening weten we dat het
 * om verschillende producten gaat, ook al noemen ze het product hetzelfde.
 */
export function packSignature(name: string): string {
  const tokens = tokenize(name);
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === 'x') {
      parts.push('x');
      continue;
    }
    if (!NUMBER_TOKEN.test(token)) continue;
    const next = tokens[i + 1];
    // "12 x 1 l" moet het volledige blok bewaren, niet alleen het eerste getal.
    if (next && (SIZE_UNIT_TOKENS.has(next) || next === 'x')) {
      parts.push(`${token}${next}`);
      i += 1;
    } else {
      parts.push(token);
    }
  }
  return parts.join(' ');
}

/**
 * De productlijn zonder variantwoord: "coca cola zero" -> "coca cola",
 * "melk halfvolle" -> "melk".
 *
 * Hiermee kun je zien dat twee namen om dezelfde productlijn gaan maar een
 * verschillende variant zijn. Dat is geen match (zie de veiligheidsklep hieronder)
 * maar wel een vraag die de gebruiker mag beantwoorden.
 */
export function baseProductName(name: string): string {
  return productCoreName(name)
    .split(' ')
    .filter((token) => !VARIANT_TOKENS.has(token))
    .join(' ');
}

function bigrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 1; i += 1) {
    set.add(padded.slice(i, i + 2));
  }
  return set;
}

/** Sørensen-Dice-coëfficiënt op bigrammen, bereik 0-1. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = bigrams(a);
  const setB = bigrams(b);
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (setA.size + setB.size);
}

/** Jaccard-similariteit op woorden, bereik 0-1. */
export function jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// ---------------------------------------------------------------------------
// Synoniemenboek
// ---------------------------------------------------------------------------

/**
 * Alternatieve schrijfwijzen per product. Alleen synoniemen die in de praktijk
 * verward worden; bewust geen gokwerk. De sleutel is de genormaliseerde naam.
 */
export const PRODUCT_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  ['coca cola', ['cola', 'coca', 'cocacola', 'coke']],
  ['coca cola zero', ['cola zero', 'coke zero', 'coca cola zero sugar', 'coca cola zero', 'coca-cola zero', 'cola zero sugar']],
  ['coca cola light', ['cola light', 'coca cola light', 'coke light']],
  ['fanta', ['fanta orange', 'fanta frisdrank']],
  ['fanta orange', ['fanta sinaasappel']],
  ['sprite', ['sprite lemon', '7up', '7 up', 'seven up']],
  ['pepsi', ['pepsi cola', 'pepsi max', 'pepsi twist']],
  ['pepsi max', ['pepsi maximum', 'pepsi max zero']],
  ['chocomel', ['choco mel', 'chocomelchocolademelk']],
  ['dubbel fris', ['dubbelfris', 'dubbelfris', 'double cola']],
  ['rivella', ['rivella original', 'rivella sport']],
  ['capri sun', ['caprisun', 'capri-sun', 'capri sun ice', 'caprisun ice']],
  [
    'kipfilet',
    ['kipfilet malse borst', 'kipborst', 'kip fillet', 'kip', 'kips'],
  ],
  ['kip dij', ['kipdij', 'kip dij borst', 'kip dijl', 'kipdijenborst']],
  ['gehakt', ['gehaakt', 'rundergehakt', 'half om half', 'gemengd gehakt']],
  ['kipgehakt', ['kip gehakt', 'kipgehakt fijn']],
  ['rijst', ['basmatirijst', 'basmaty', 'pasta rijst', 'rijst']],
  ['spaghetti', ['spagetti', 'spagheti', 'spaghetti bolognese']],
  ['brood', ['wit brood', 'volkorenbrood', 'tarwebrood', 'desembrood']],
  ['melk', ['koemelk', 'verse melk', 'melk', 'volle melk', 'halfvolle melk', 'magere melk']],
  ['eieren', ['ei', 'eiers', 'kippeieren', 'eieren', 'schooneieren']],
  ['boter', ['roomboter', 'dieetboter', 'ongezouten boter']],
  ['kaas', ['goudse kaas', 'oude kaas', 'joodse kaas', 'belegen kaas', 'edammer']],
  ['yoghurt', ['yogurt', 'yoght', 'griekse yoghurt', 'skyfer', 'yoghurt']],
  ['aardappels', ['aardappel', 'aardappelen', 'krieltjes', 'vast kokende aardappels']],
  ['tomaat', ['tomaten', 'trossige tomaten', 'cherrytomaten', 'tomaat']],
  ['ui', ['uien', 'zoete ui', 'rode ui']],
  ['knoflook', ['knoflookteentjes']],
  ['sla', ['kropssla', 'ijsbergsla', 'romaine', 'sla']],
  ['broccoli', ['broccolistruct']],
  ['wortel', ['wortels', 'boswortel', 'winterwortel']],
  ['paprika', ['rode paprika', 'groene paprika', 'gele paprika', 'paprika']],
  ['champignon', ['champignons', 'paddestoelen']],
  ['water', ['spa', 'spa rood', 'spa blauw', 'still water', 'kraanwater', 'water fles', 'waterfles', 'spaarwater']],
  ['sap', ['jus', 'orange sap', 'appelsap', 'troebel sap', 'vruchtensap', 'sinaasappelsap']],
  ['bier', ['pils', 'pilsener', 'lager', 'witbier', 'amstel', 'heineken', 'grolsch', 'jopen']],
  ['wijn', ['rode wijn', 'witte wijn', 'rose', 'rode fles wijn']],
  ['chips', ['aardappelchips', 'paprikachips', 'zout chips', 'chips']],
  ['chocolade', ['melkchocolade', 'pure chocolade', 'reep', 'chocoladereep']],
  ['ijs', ['vanilleijs', 'softij', 'schepijs', 'ijs']],
  ['koffie', ['koffiebonen', 'gemalen koffie', 'filterkoffie', 'espresso', 'koffie capsules', 'koffie']],
  ['thee', ['theebladeren', 'zwarte thee', 'groene thee', 'thezakjes', 'thee']],
  ['zeep', ['handzeep', 'vloeibare zeep', 'douchegel', 'zeep']],
  ['tandpasta', ['tandenpoetser']],
  ['wc papier', ['toiletpapier', 'wc papier']],
  ['schoonmaakmiddel', ['allesreiniger', 'vloerreiniger', 'glansmiddel', 'schoonmaakmiddel']],
]);

/**
 * Woorden die een variant aangeven. Twee producten die op deze woorden
 * verschillen zijn NIET hetzelfde product: "cola" en "cola zero" mogen nooit
 * in één regel worden samengevoegd.
 */
export const VARIANT_TOKENS: ReadonlySet<string> = new Set([
  'zero', 'light', 'sugar', 'sugarfree', 'suikervrij', 'original', 'regular',
  'max', 'maximum', 'twist', 'exotic', 'spicy', 'mild', 'extra', 'double', 'diet',
  'zonder', 'suiker', 'naturel', 'lokaal', 'bio', 'fairtrade', 'decaffeine',
  'caffeinevrij', 'premium', 'classic', 'select', 'plus', 'air', 'ultra', 'kruidig',
]);

/** Haalt de variantwoorden uit een genormaliseerde naam. */
export function variantTokens(normalizedName: string): Set<string> {
  const found = new Set<string>();
  for (const token of normalizedName.split(' ')) {
    if (VARIANT_TOKENS.has(token)) found.add(token);
  }
  return found;
}

/** Zijn de variantwoorden van twee namen verschillend? */
export function hasVariantConflict(a: string, b: string): boolean {
  const va = variantTokens(normalizeName(a));
  const vb = variantTokens(normalizeName(b));
  if (va.size === 0 && vb.size === 0) return false;
  for (const token of va) {
    if (!vb.has(token)) return true;
  }
  for (const token of vb) {
    if (!va.has(token)) return true;
  }
  return false;
}

/** Extra synoniemen die de gebruiker zelf heeft bevestigd (uit de database). */
export type UserSynonyms = ReadonlyMap<string, readonly string[]>;

export interface SynonymIndex {
  /** genormaliseerde alias -> canonieke productnaam (weergegeven zoals de gebruiker het wil zien) */
  readonly canonicalByAlias: ReadonlyMap<string, string>;
  /** productnaam -> aliasen */
  readonly aliasesByCanonical: ReadonlyMap<string, readonly string[]>;
  /**
   * De aliassen die de gebruiker zelf heeft bevestigd.
   *
   * Die wegen zwaarder dan alles wat in dit bestand staat. Zodra iemand zelf
   * zegt dat "cola" het product "Coca-Cola regular" is, is dat het antwoord en
   * geen vraag meer — ook niet als de variantwoorden elkaar tegenspreken. De
   * variantcontrole blijft wél staan voor namen die de gebruiker nog niet heeft
   * bevestigd, want daar zouden we het zelf kunnen verzinnen.
   */
  readonly userAliases: ReadonlySet<string>;
}

/**
 * Bouwt de index van productnamen.
 *
 * De ingebouwde synoniemen worden eerst geregistreerd. Daarna komen de
 * synoniemen van de gebruiker, en die mogen een ingebouwd alias overschrijven:
 * als de gebruiker zelf zegt dat twee namen hetzelfde zijn, is dat het sterkste
 * signaal dat we hebben. Zonder die overschrijving zou een eigen synoniem
 * stilzwijgend worden genegeerd zodra de naam ook in de ingebouwde lijst staat.
 *
 * Let op: de variantwoorden (zie VARIANT_TOKENS) blijven leidend. Ook als de
 * gebruiker "cola" en "cola zero" zou samenvoegen, blijven dat twee producten,
 * want dat is vrijwel altijd een vergissing.
 */
export function buildSynonymIndex(userSynonyms?: UserSynonyms): SynonymIndex {
  const canonicalByAlias = new Map<string, string>();
  const aliasesByCanonical = new Map<string, string[]>();
  const userAliases = new Set<string>();

  const register = (alias: string, canonical: string, overwrite = false, isUserAlias = false): void => {
    const key = normalizeName(alias);
    if (!key) return;
    if (overwrite || !canonicalByAlias.has(key)) canonicalByAlias.set(key, canonical);
    const list = aliasesByCanonical.get(canonical) ?? [];
    if (!list.includes(alias)) list.push(alias);
    aliasesByCanonical.set(canonical, list);
    if (isUserAlias) userAliases.add(key);
  };

  for (const [canonical, aliases] of PRODUCT_SYNONYMS) {
    register(canonical, canonical);
    for (const alias of aliases) register(alias, canonical);
  }

  if (userSynonyms) {
    for (const [canonical, aliases] of userSynonyms) {
      register(canonical, canonical, true, true);
      for (const alias of aliases) register(alias, canonical, true, true);
    }
  }

  return { canonicalByAlias, aliasesByCanonical, userAliases };
}

// ---------------------------------------------------------------------------
// Categorieën
// ---------------------------------------------------------------------------

export type ProductCategory =
  | 'groente'
  | 'fruit'
  | 'zuivel'
  | 'vlees'
  | 'vis'
  | 'brood'
  | 'voorradskast'
  | 'snacks'
  | 'drank'
  | 'dieet'
  | 'huishouden'
  | 'overig';

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  groente: 'Groente',
  fruit: 'Fruit',
  zuivel: 'Zuivel',
  vlees: 'Vlees & Worst',
  vis: 'Vis',
  brood: 'Brood & Banket',
  voorradskast: 'Voorradskast',
  snacks: 'Snacks & Zoet',
  drank: 'Dranken',
  dieet: 'Dieet',
  huishouden: 'Huishouden',
  overig: 'Overig',
};

const CATEGORY_KEYWORDS: ReadonlyArray<readonly [ProductCategory, readonly string[]]> = [
  [
    'drank',
    [
      'cola', 'fanta', 'sprite', 'pepsi', 'chocomel', 'dubbelfris', 'rivella', 'water', 'spa',
      'sap', 'jus', 'sinaasappelsap', 'appelsap', 'troebel', 'bier', 'pils', 'wijn', 'rose',
      'koffie', 'thee', 'limonade', 'soda', 'tonic', 'bitter', 'likeur', 'energy', 'isotonic',
      'sportdrank', 'bosdrank', 'yodrano', 'chocomel', 'melksplit', 'baba', 'chocomelk',
    ],
  ],
  [
    'groente',
    ['aardappel', 'aardappels', 'sla', 'kropssla', 'ijsbergsla', 'sperzie', 'broccoli', 'wortel',
      'paprika', 'tomaat', 'komkommer', 'Ui', 'knoflook', 'champignon', 'prei', 'selderij',
      'courgette', 'asperge', 'bloemkool', 'witlof', 'andijvie', 'spinazie', 'peterselie', 'banaan'],
  ],
  ['fruit', ['appel', 'banana', 'sinaasappel', 'peer', 'appel', 'druif', 'aardbei', 'framboos', 'mandarijn', 'limoen', 'citroen', 'mango', 'kiwi', 'perzik', 'pruim', 'watermeloen']],
  ['zuivel', ['melk', 'kaas', 'boter', 'yoghurt', 'yogurt', 'kwark', 'creme', 'room', 'slagroom', 'eieren', 'ei', 'margarine', 'verse', 'karnemelk', 'halaal', 'schmelz']],
  ['vlees', ['kip', 'kipfilet', 'runder', 'varken', 'gehakt', 'worst', 'bacon', 'ham', 'lamsvlees', 'kalfs', 'steak', 'braad', 'küchen', 'hamburger', 'sate', 'worst', 'kipdij', 'kippoot']],
  ['vis', ['zalm', 'gamba', 'garnalen', 'kibbeling', 'kabeljauw', 'tonijn', 'vis', 'garnalen', 'zilvervis', 'forel']],
  ['brood', ['brood', 'bagel', 'croissant', 'krant', 'beschuit', 'cracker', 'toast', 'tosti', 'banket', 'taart', 'cookie', 'scones']],
  ['voorradskast', ['rijst', 'pasta', 'spaghetti', 'macaroni', 'meel', 'bloem', 'suiker', 'zout', 'olie', 'azijn', 'saus', 'tomatensaus', 'kruiden', 'salsa', 'soep', 'broodje', 'honing', 'jam', 'pindakaas', 'mayonaise', 'ketchup', 'mosterd', 'sperziebonen', 'mais', 'champignon', 'wijn', 'blik', 'ingredi', 'ontbijtgranola', 'cornflakes', 'havermelk']],
  ['snacks', ['chips', 'chocolade', 'reep', 'snoep', 'biscuit', 'koek', 'cracker', 'noot', 'noten', 'pinda', 'zout', 'popcorn', 'ijs', 'vanilleijs', 'dessert', 'toffee']],
  ['dieet', ['dieet', 'volkoren', 'mager', 'light', 'suikervrij', 'glutenvrij', 'lactosevrij', 'vegetarisch', 'veganistisch', 'bio', 'halal', 'kosher', 'plantaardig']],
  ['huishouden', ['zeep', 'tandpasta', 'wc', 'toilet', 'schoonmaak', 'was', 'vaat', 'spons', 'doek', 'zeep', 'schoonmaakmiddel', 'glans', 'vloer', 'tissue', 'servet', 'zak', 'afvalzak', 'folie', 'bakpapier', 'lucifer', 'lucifersen', 'batterij', 'batterijen', 'zeep']],
];

/** Vindt de meest specifieke categorie voor een productnaam. */
export function inferCategory(name: string, index?: SynonymIndex): ProductCategory {
  const normalized = normalizeName(name);
  if (!normalized) return 'overig';
  const tokens = new Set(normalized.split(' '));

  if (index?.canonicalByAlias.has(normalized)) {
    const canonical = index.canonicalByAlias.get(normalized)!;
    const category = categoryOfCanonical(canonical);
    if (category) return category;
  }

  // Zoek het langste trefwoord (meest specifiek) dat voorkomt.
  let best: { category: ProductCategory; length: number } | null = null;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const keyword of keywords) {
      const key = normalizeName(keyword);
      if (!key) continue;
      const isTokenMatch = tokens.has(key);
      const isSubstringMatch = normalized.includes(key);
      if (!isTokenMatch && !isSubstringMatch) continue;
      const length = key.length;
      if (!best || length > best.length) best = { category, length };
    }
  }
  return best?.category ?? 'overig';
}

function categoryOfCanonical(canonical: string): ProductCategory | null {
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const keyword of keywords) {
      if (normalizeName(keyword) === canonical) return category;
    }
  }
  // De canonieke naam zelf kan ook een trefwoord zijn.
  return null;
}

// ---------------------------------------------------------------------------
// Matchen
// ---------------------------------------------------------------------------

export const AUTO_MATCH_THRESHOLD = 0.92;
export const SUGGEST_THRESHOLD = 0.68;
/**
 * Zekerheid die een kandidaat krijgt als de namen op een variant verschillen.
 * Dat is bewust net boven SUGGEST_THRESHOLD: zo'n kandidaat hoort bij de
 * gebruiker te komen ("is dit de regular of de zero?"), maar mag nooit stil
 * worden bevestigd.
 */
export const VARIANT_SUGGEST_CONFIDENCE = 0.7;
/**
 * Als de beste twee kandidaten binnen dit verschil zitten, is het niet meer
 * eenduidig en vragen we het aan de gebruiker.
 */
export const AMBIGUITY_MARGIN = 0.05;

export interface MatchCandidate {
  /** Interne product-id uit de database. */
  productId: string;
  /** Weergegeven productnaam. */
  name: string;
  /** Zekerheid 0-1. */
  confidence: number;
  /** Menselijk leesbare onderbouwing, bv. "synoniem van Coca-Cola". */
  reason: MatchExplanation;
}

export type MatchExplanation =
  | 'exact'
  | 'canonieke-synonieem'
  | 'zelfde-woorden'
  | 'sterk-afwijkende-spelling'
  | 'gedeeltelijke-overlap'
  | 'andere-variant';

export type MatchVerdict =
  | { kind: 'match'; product: MatchCandidate }
  | { kind: 'suggest'; candidates: MatchCandidate[] }
  | { kind: 'none'; candidates: MatchCandidate[] };

export interface MatchableProduct {
  id: string;
  name: string;
  /** Optioneel: bekende hoeveelheid, bv. "1,5 l" of "330 ml". */
  quantityHint?: string | null;
  category?: ProductCategory | null;
}

/**
 * Zoekt het beste bestaande product voor een ingevoerde naam.
 * Geeft nooit zelfzeker een verkeerd antwoord: onzekerheid leidt altijd tot
 * `suggest`, zodat de gebruiker kan kiezen.
 *
 * De vergelijking gaat over de kern van de naam: verpakking ("1 l", "fles")
 * wordt weggehaald, zodat "melk" wel "Melk 1 l" herkent. De variantcontrole
 * loopt wél over de volledige naam, zodat "cola" nooit stil aan "cola zero"
 * wordt gekoppeld.
 */
export function matchProduct(
  inputName: string,
  candidates: readonly MatchableProduct[],
  index: SynonymIndex = buildSynonymIndex(),
): MatchVerdict {
  const normalizedInput = normalizeName(inputName);
  if (!normalizedInput || candidates.length === 0) return { kind: 'none', candidates: [] };

  const inputCore = productCoreName(inputName);
  if (inputCore.length === 0) return { kind: 'none', candidates: [] };

  const inputCanonical = index.canonicalByAlias.get(normalizedInput) ?? null;
  const inputCoreCanonical = index.canonicalByAlias.get(inputCore) ?? null;
  // De productlijn van de invoer, zonder variantwoord. Hiermee herkennen we
  // "cola" bij "Coca-Cola zero" als dezelfde lijn met een andere variant.
  const inputBaseCanonical = index.canonicalByAlias.get(baseProductName(inputName)) ?? null;
  const inputTokens = inputCore.split(' ');

  const scored: MatchCandidate[] = [];
  /** Kernnaam per product, nodig om dubbele titels van echte tegenspraak te onderscheiden. */
  const coreByProductId = new Map<string, string>();
  /** Packvorm per product: "Melk 1 l" en "Melk 3 l" zijn niet hetzelfde product. */
  const packByProductId = new Map<string, string>();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeName(candidate.name);
    if (!normalizedCandidate) continue;
    // Producten die alleen uit maatvoering bestaan ("1 l") zijn niet matchbaar.
    const candidateCore = hasUsableCore(candidate.name) ? productCoreName(candidate.name) : '';
    if (candidateCore.length === 0) continue;

    const candidateCanonical = index.canonicalByAlias.get(normalizedCandidate) ?? null;
    const candidateCoreCanonical = index.canonicalByAlias.get(candidateCore) ?? null;
    const candidateBaseCanonical = index.canonicalByAlias.get(baseProductName(candidate.name)) ?? null;

    let confidence = 0;
    let reason: MatchExplanation = 'gedeeltelijke-overlap';

    if (inputCore === candidateCore) {
      confidence = 1;
      reason = 'exact';
    } else if (inputCoreCanonical && inputCoreCanonical === candidateCoreCanonical) {
      confidence = 0.98;
      reason = 'canonieke-synonieem';
    } else if (inputCanonical && candidateCanonical && inputCanonical === candidateCanonical) {
      confidence = 0.96;
      reason = 'canonieke-synonieem';
    } else if (inputBaseCanonical && inputBaseCanonical === candidateBaseCanonical) {
      // Zelfde productlijn, maar de een is een variant van de ander. Dat is nooit
      // een automatische match; het is precies waar je de gebruiker over vraagt.
      confidence = VARIANT_SUGGEST_CONFIDENCE;
      reason = 'andere-variant';
    } else {
      const candidateTokens = candidateCore.split(' ');
      const sameMultiset =
        inputTokens.length === candidateTokens.length &&
        [...inputTokens].sort().join(' ') === [...candidateTokens].sort().join(' ');
      if (sameMultiset) {
        confidence = 0.94;
        reason = 'zelfde-woorden';
      } else {
        const dice = diceCoefficient(inputCore, candidateCore);
        const jaccard = jaccardTokens(inputTokens, candidateTokens);
        // De drempel is bewust hoog: liever een vraag dan een foutieve match.
        if (dice >= 0.88 && jaccard >= 0.6) {
          confidence = Math.min(0.9, 0.7 + dice * 0.22);
          reason = 'sterk-afwijkende-spelling';
        } else if (dice >= 0.6 || jaccard >= 0.5) {
          confidence = Math.min(0.75, 0.45 + Math.max(dice, jaccard) * 0.4);
          reason = 'gedeeltelijke-overlap';
        }
      }
    }

    // Veiligheidsklep: als de variantwoorden verschillen is het NIET hetzelfde
    // product. "cola" en "cola zero" mogen nooit automatisch worden samengevoegd.
    // De kandidaat blijft wel staan, maar dan als vraag aan de gebruiker.
    // Een naam die de gebruiker zelf heeft bevestigd ontkomt hieraan: die heeft
    // tenslotte zelf gezegd dat het om hetzelfde product gaat.
    const userConfirmed = index.userAliases.has(normalizedInput) || index.userAliases.has(inputCore);
    if (confidence >= AUTO_MATCH_THRESHOLD && !userConfirmed && hasVariantConflict(inputName, candidate.name)) {
      confidence = VARIANT_SUGGEST_CONFIDENCE;
      reason = 'andere-variant';
    }

    if (confidence > 0) {
      scored.push({ productId: candidate.id, name: candidate.name, confidence: round2(confidence), reason });
      coreByProductId.set(candidate.id, candidateCore);
      packByProductId.set(candidate.id, packSignature(candidate.name));
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (best && best.confidence >= AUTO_MATCH_THRESHOLD) {
    // Twee kandidaten die even goed scoren zijn een echte keuze, tenzij ze
    // feitelijk hetzelfde product zijn: "Melk 1 l" bij twee winkels mag gerust
    // samengevoegd worden, maar "Melk 1 l" tegenover "Melk 3 l" niet.
    const contenders = scored.filter(
      (c) => c.productId !== best.productId && best.confidence - c.confidence < AMBIGUITY_MARGIN,
    );
    const bestCore = coreByProductId.get(best.productId);
    const bestPack = packByProductId.get(best.productId);
    const distinct = contenders.filter(
      (c) =>
        coreByProductId.get(c.productId) !== bestCore ||
        packByProductId.get(c.productId) !== bestPack,
    );
    if (distinct.length === 0) return { kind: 'match', product: best };

    const tied = [best, ...contenders].slice(0, 5);
    return { kind: 'suggest', candidates: tied };
  }
  const suggestions = scored.filter((c) => c.confidence >= SUGGEST_THRESHOLD).slice(0, 5);
  if (suggestions.length > 0) return { kind: 'suggest', candidates: suggestions };
  return { kind: 'none', candidates: scored.slice(0, 3) };
}

export function explainMatch(reason: MatchExplanation): string {
  switch (reason) {
    case 'exact':
      return 'Exacte naam';
    case 'canonieke-synonieem':
      return 'Gekend synoniem';
    case 'zelfde-woorden':
      return 'Zelfde woorden, andere volgorde';
    case 'sterk-afwijkende-spelling':
      return 'Sterk afwijkende spelling';
    case 'andere-variant':
      return 'Andere variant, even bevestigen';
    case 'gedeeltelijke-overlap':
      return 'Gedeeltelijke overlap';
    default:
      return 'Onbekend';
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Geeft de canonieke productnaam terug, of de ingevoerde naam zelf. */
export function canonicalName(name: string, index: SynonymIndex = buildSynonymIndex()): string {
  const normalized = normalizeName(name);
  return index.canonicalByAlias.get(normalized) ?? name.trim();
}
