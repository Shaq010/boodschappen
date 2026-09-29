/**
 * Vrije-tekstparser voor de boodschappenlijst.
 *
 * Ondersteunt invoer zoals:
 *   "melk, brood, cola, kipfilet, rijst, eieren"
 *   "2x melk"
 *   "1 kg kipfilet"
 *   "6 eieren"
 *   "3 flessen cola"
 *   "500 gram gehakt"
 *   "1,5 l melk"
 *   "twee pakken spaghetti"
 *   "halve kilo rijst"
 *
 * Ontwerp: de parser is bewust voorzichtig. Wat niet met zekerheid kan worden
 * geïnterpreteerd, wordt als aanname (`assumptions`) teruggegeven zodat de
 * interface dit aan de gebruiker kan tonen in plaats van stil te gokken.
 */

import {
  type Quantity,
  UNITS,
  defaultQuantity,
  formatQuantity,
  getUnit,
  isUnitAlias,
  makeQuantity,
  roundQuantity,
} from './units.js';

// ---------------------------------------------------------------------------
// Woordenboek van Nederlandse hoeveelheden
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  een: 1,
  één: 1,
  eenmaal: 1,
  keer: 1,
  twee: 2,
  paar: 2,
  duo: 2,
  drietal: 3,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  elf: 11,
  twaalf: 12,
  dertien: 13,
  half: 0.5,
  halve: 0.5,
  helft: 0.5,
  kwart: 0.25,
  kwartje: 0.25,
};

const AMOUNT_WORD_ALIASES: Record<string, string> = {
  'één': 'een',
};

/** Woorden die nooit een productnaam zijn en dus veilig weg mogen. */
const FILLER_WORDS = new Set(['en', 'per', 'x', 'of', 'met', 'van', 'de', 'het', 'een']);

// ---------------------------------------------------------------------------
// Resultaattypen
// ---------------------------------------------------------------------------

export interface ParseAssumption {
  code:
    | 'aantal-zonder-eenheid'
    | 'eenheid-onbekend'
    | 'productnaam-corrigeerd'
    | 'rangschikking-aangepast';
  message: string;
}

export interface ParsedItem {
  /** De oorspronkelijke invoerregel. */
  raw: string;
  /** Productnaam zonder hoeveelheid. */
  name: string;
  /** Genormaliseerde hoeveelheid. */
  quantity: Quantity;
  /** Hoe zeker we zijn van de interpretatie (0-1). */
  confidence: number;
  /** Aannames die de gebruiker kan controleren. */
  assumptions: ParseAssumption[];
}

export interface BulkParseResult {
  items: ParsedItem[];
  /** Regels die niets bruikbaars opleverden. */
  ignored: string[];
}

// ---------------------------------------------------------------------------
// Opsplitsen
// ---------------------------------------------------------------------------

/**
 * Splits ruwe tekst op in losse regels. Scheidingstekens zijn nieuwe regels,
 * puntkomma's, pipes en opsommingstekens. De woorden "en" en "of" worden
 * bewust NIET gebruikt: "brood en kaas" is één regel.
 *
 * Een komma wordt alleen als scheidingsteken gezien als er geen cijfer vóór
 * staat. In het Nederlands is de komma namelijk het decimale scheidingsteken:
 * "1,5 l cola" is één regel van 1,5 liter, geen "1" plus "5 l cola". Alleen
 * komma's zoals in "melk, brood" of "2 melk, 3 brood" splitsen.
 */
export function splitInputLines(text: string): string[] {
  return text
    .split(/[\n\r;|]+/g)
    .flatMap((chunk) => chunk.split(/,\s*(?=\D)|(?<=\d),(?![\d])|\s+•\s+|\s+·\s+|\s+-\s+|\s+–\s+/g))
    .map((line) => stripListMarker(line.trim()))
    .filter((line) => line.length > 0);
}

function stripListMarker(line: string): string {
  return line
    .replace(/^[-*•·▪◦]+\s*/, '')
    .replace(/^\d+\s*[.)]\s+(?=\D)/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Hoeveelheid + eenheid herkennen
// ---------------------------------------------------------------------------

interface AmountMatch {
  amount: number;
  /** Aantal basiseenheden, of de eenheidcode wanneer er geen eenheid volgde. */
  unitCode: string | null;
  /** De rest van de tekst. */
  rest: string;
  /** Lente van het herkende fragment. */
  consumed: number;
}

const NUMERIC_AMOUNT = /^(\d+(?:[.,]\d+)?|\d{1,2}\s?½|½|¼)\s*/;

/** Zoekt een hoeveelheid aan het begin van de tekst. */
function matchLeadingAmount(text: string): AmountMatch | null {
  const numeric = text.match(NUMERIC_AMOUNT);
  if (numeric?.[1]) {
    const amount = parseNumericAmount(numeric[1]);
    if (amount !== null) {
      const afterNumber = text.slice(numeric[0].length);
      // "2x melk", "2 x melk", "2*melk", "2·melk"
      const xMatch = afterNumber.match(/^\s*[x×*]\s*/i);
      if (xMatch) {
        const afterX = afterNumber.slice(xMatch[0].length);
        // "2 x 1,5 l cola": het eerste getal is het aantal, het tweede de
        // verpakkingsgrootte. We vermenigvuldigen ze.
        const inner = matchLeadingAmount(afterX);
        if (inner && (inner.unitCode === 'g' || inner.unitCode === 'ml' || inner.unitCode === 'l' || inner.unitCode === 'kg')) {
          return {
            amount: amount * inner.amount,
            unitCode: inner.unitCode,
            rest: inner.rest,
            consumed: text.length,
          };
        }
        return { amount, unitCode: null, rest: afterX, consumed: text.length };
      }
      const unit = matchUnit(afterNumber);
      if (unit) {
        return {
          amount,
          unitCode: unit.code,
          rest: afterNumber.slice(unit.length),
          consumed: text.length - afterNumber.length + unit.length,
        };
      }
      // Alleen een los getal: "6 eieren" -> aantal stuks.
      return { amount, unitCode: 'st', rest: afterNumber, consumed: numeric[0].length };
    }
  }

  // Getalswoorden: "twee flessen cola", "halve kilo rijst"
  const [firstWord = ''] = text.split(/\s+/, 1);
  const normalizedWord = AMOUNT_WORD_ALIASES[firstWord] ?? firstWord.toLowerCase();
  const amount = NUMBER_WORDS[normalizedWord];
  if (amount === undefined) return null;

  const afterWord = text.slice(firstWord.length).replace(/^\s+/, '');
  const unit = matchUnit(afterWord);
  if (unit) {
    return {
      amount,
      unitCode: unit.code,
      rest: afterWord.slice(unit.length),
      consumed: text.length - afterWord.length + unit.length,
    };
  }
  return { amount, unitCode: 'st', rest: afterWord, consumed: firstWord.length };
}

function parseNumericAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '½') return 0.5;
  if (trimmed === '¼') return 0.25;
  const halfMatch = trimmed.match(/^(\d{1,2})\s?½$/);
  if (halfMatch?.[1]) return Number(halfMatch[1]) + 0.5;
  const normalized = trimmed.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

interface UnitMatch {
  code: string;
  length: number;
}

/** Herkent een eenheid aan het begin van een tekst, alleen als er een spatie staat. */
function matchUnit(text: string): UnitMatch | null {
  const trimmedStart = text.replace(/^\s+/, '');
  const leadingSpaces = text.length - trimmedStart.length;
  const [word = ''] = trimmedStart.split(/[\s.,;:!?()]/, 1);
  if (!word) return null;
  const lower = word.toLowerCase().replace(/\.$/, '');
  if (!isUnitAlias(lower)) return null;
  return { code: getUnitByAliasCode(lower), length: leadingSpaces + word.length };
}

function getUnitByAliasCode(alias: string): string {
  // isUnitAlias heeft al gecontroleerd dat deze alias bestaat.
  const match = UNIT_ALIAS_LOOKUP.get(alias);
  if (!match) throw new Error(`Alias zonder eenheiddefinitie: ${alias}`);
  return match;
}

const UNIT_ALIAS_LOOKUP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const unit of UNITS) {
    for (const alias of unit.aliases) {
      if (!map.has(alias)) map.set(alias, unit.code);
    }
  }
  return map;
})();

/**
 * Herkent een hoeveelheid die ACHTER de productnaam staat, bv. "melk 2 liter".
 * Alleen met een expliciete eenheid, want een los getal achteraan is te
 * dubbelzinnig ("brood 2" versus "brood 2 kg").
 */
function matchTrailingAmount(text: string): AmountMatch | null {
  const match = text.match(/\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)\s*$/);
  const [, number, rawUnit] = match ?? [];
  if (!number || !rawUnit) return null;
  const lowerUnit = rawUnit.toLowerCase();
  if (!isUnitAlias(lowerUnit)) return null;
  const amount = parseNumericAmount(number);
  if (amount === null) return null;
  return {
    amount,
    unitCode: getUnitByAliasCode(lowerUnit),
    rest: text.slice(0, match!.index),
    consumed: text.length,
  };
}

// ---------------------------------------------------------------------------
// Hoofdparser
// ---------------------------------------------------------------------------

/** Verwijdert losse vulwoorden aan het begin of einde van een productnaam. */
function trimFiller(name: string): string {
  let result = name.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const filler of FILLER_WORDS) {
      const re = new RegExp(`^${filler}\\s+`, 'i');
      if (re.test(result) && result.split(/\s+/).length > 1) {
        result = result.replace(re, '');
        changed = true;
      }
    }
    result = result.replace(/\s+$/, '');
  }
  return result;
}

/** Geeft een productnaam netter weer zonder de betekenis te veranderen. */
function tidyName(name: string): { name: string; changed: boolean } {
  let result = name.replace(/\s{2,}/g, ' ').trim();
  result = result.replace(/^[\s,;.:-]+/, '').replace(/[\s,;.:-]+$/, '');
  const before = result;
  result = result.replace(/^(\d+)\s*[.)]\s+(?=\D)/, '');
  return { name: result, changed: result !== before };
}

export function parseItem(input: string): ParsedItem | null {
  const raw = input.trim();
  if (!raw) return null;

  let working = stripListMarker(raw);
  let match = matchLeadingAmount(working);
  let amountWasTrailing = false;

  if (!match) {
    match = matchTrailingAmount(working);
    amountWasTrailing = match !== null;
  }

  const assumptions: ParseAssumption[] = [];
  let amount = 1;
  let unitCode: string | null = null;
  let rest = working;

  if (match) {
    amount = match.amount;
    unitCode = match.unitCode;
    rest = match.rest;
  }

  if (match && !amountWasTrailing && match.unitCode === 'st' && match.consumed > 0) {
    // "6 eieren" -> 6 stuks is veilig. "2 melk" -> 2 stuks is een aanname.
    const looksLikeUnitCount = match.consumed > 0 && /^\s*x/i.test(raw.slice(match.consumed)) === false;
    if (looksLikeUnitCount && amount === Math.floor(amount)) {
      assumptions.push({
        code: 'aantal-zonder-eenheid',
        message: `"${formatQuantity(defaultQuantity(amount))}" aangenomen — corrigeer de eenheid indien nodig.`,
      });
    }
  }

  const tidied = tidyName(trimFiller(rest));
  const name = tidied.name;

  if (!name) {
    // Alleen een hoeveelheid getypt, bv. "2 kg". Dit is geen bruikbaar product.
    return null;
  }
  if (tidied.changed) {
    assumptions.push({
      code: 'productnaam-corrigeerd',
      message: `Productnaam genormaliseerd naar "${name}".`,
    });
  }

  const quantity = unitCode ? makeQuantity(amount, unitCode) : defaultQuantity(amount);
  const confidence = computeConfidence({ matched: Boolean(match), unitCode, amount, name, trailing: amountWasTrailing });

  return { raw, name, quantity, confidence, assumptions };
}

function computeConfidence(input: {
  matched: boolean;
  unitCode: string | null;
  amount: number;
  name: string;
  trailing: boolean;
}): number {
  if (input.name.split(/\s+/).length === 1) {
    return input.unitCode ? 0.97 : 0.85;
  }
  if (!input.matched) return 0.8;
  if (input.unitCode) return input.trailing ? 0.9 : 0.96;
  return 0.75;
}

/** Parseert een tekstblok met meerdere producten. */
export function parseBulkText(text: string): BulkParseResult {
  const lines = splitInputLines(text);
  const items: ParsedItem[] = [];
  const ignored: string[] = [];

  for (const line of lines) {
    const item = parseItem(line);
    if (item) items.push(item);
    else ignored.push(line);
  }

  return { items, ignored };
}

/** Parseert een door de gebruiker bevestigde hoeveelheid uit losse velden. */
export function parseSingleInput(name: string, amountInput = '', unitInput = ''): ParsedItem | null {
  const cleanName = tidyName(trimFiller(name)).name;
  if (!cleanName) return null;

  const amount = amountInput.trim() ? Number(amountInput.replace(',', '.')) : 1;
  const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 1;

  if (unitInput.trim()) {
    const unit = getUnitByAliasCodeSafe(unitInput.trim().toLowerCase());
    if (unit) {
      return {
        raw: `${safeAmount} ${unit} ${cleanName}`,
        name: cleanName,
        quantity: makeQuantity(safeAmount, unit),
        confidence: 1,
        assumptions: [],
      };
    }
  }
  return {
    raw: cleanName,
    name: cleanName,
    quantity: defaultQuantity(safeAmount),
    confidence: unitInput.trim() ? 0.6 : 0.85,
    assumptions: unitInput.trim()
      ? [{ code: 'eenheid-onbekend', message: `Onbekende eenheid "${unitInput}" — aantal stuks aangenomen.` }]
      : [],
  };
}

function getUnitByAliasCodeSafe(alias: string): string | null {
  return UNIT_ALIAS_LOOKUP.get(alias) ?? null;
}

export { roundQuantity };
