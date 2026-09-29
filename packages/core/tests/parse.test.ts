import { describe, expect, it } from 'vitest';
import { parseBulkText, parseItem, splitInputLines } from '../src/parse.js';
import { combineQuantities, defaultQuantity, formatQuantity, makeQuantity } from '../src/units.js';

describe('splitInputLines', () => {
  it('splits de voorbeeldinvoer uit de opdracht op', () => {
    const lines = splitInputLines('melk, brood, cola, kipfilet, rijst, eieren');
    expect(lines).toEqual(['melk', 'brood', 'cola', 'kipfilet', 'rijst', 'eieren']);
  });

  it('splits op newlines en opsommingstekens', () => {
    const lines = splitInputLines('melk\n- brood\n• cola\n* rijst');
    expect(lines).toEqual(['melk', 'brood', 'cola', 'rijst']);
  });

  it('laat "en" staan omdat "brood en kaas" een product kan zijn', () => {
    expect(splitInputLines('brood en kaas')).toEqual(['brood en kaas']);
  });

  it('verwijdert nummering zoals "1. melk"', () => {
    expect(splitInputLines('1. melk\n2. brood')).toEqual(['melk', 'brood']);
  });

  it('spliet NIET op de decimale komma van een Nederlandse hoeveelheid', () => {
    // "1,5 l" is één regel van 1,5 liter, geen "1" en "5 l".
    expect(splitInputLines('1,5 l cola')).toEqual(['1,5 l cola']);
    expect(splitInputLines('0,5l water')).toEqual(['0,5l water']);
    expect(splitInputLines('1,5 l cola, 2 melk')).toEqual(['1,5 l cola', '2 melk']);
  });

  it('leest de hoeveelheid na een komma-splitsing alsnog goed', () => {
    const result = parseBulkText('2 melk, 1,5 l cola zero, 3 pakken yoghurt');
    expect(result.ignored).toEqual([]);
    expect(result.items.map((i) => [i.name, i.quantity.amount, i.quantity.unit])).toEqual([
      ['melk', 2, 'st'],
      ['cola zero', 1500, 'ml'],
      ['pakken yoghurt', 3, 'st'],
    ]);
  });
});

describe('parseItem — voorbeelden uit de opdracht', () => {
  const cases: Array<[string, string, number, string]> = [
    ['2x melk', 'melk', 2, 'st'],
    ['1 kg kipfilet', 'kipfilet', 1, 'kg'],
    ['6 eieren', 'eieren', 6, 'st'],
    ['3 flessen cola', 'cola', 3, 'fles'],
    ['500 gram gehakt', 'gehakt', 500, 'g'],
  ];

  for (const [input, name, amount, unit] of cases) {
    it(`parseert "${input}"`, () => {
      const parsed = parseItem(input);
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe(name);
      expect(parsed!.quantity.originalAmount).toBe(amount);
      expect(parsed!.quantity.originalUnit).toBe(unit);
    });
  }
});

describe('parseItem — overige invoervormen', () => {
  it('leest komma als decimaalteken', () => {
    const parsed = parseItem('1,5 kg gehakt')!;
    expect(parsed.quantity.amount).toBe(1500);
    expect(parsed.quantity.unit).toBe('g');
  });

  it('leest punt als decimaalteken', () => {
    expect(parseItem('1.5 l melk')!.quantity.amount).toBe(1500);
  });

  it('ondersteunt losse eenheid zonder spatie', () => {
    expect(parseItem('500gram gehakt')!.quantity.amount).toBe(500);
  });

  it('ondersteunt getalswoorden', () => {
    expect(parseItem('twee flessen cola')!.quantity.originalAmount).toBe(2);
    expect(parseItem('drie eieren')!.quantity.originalAmount).toBe(3);
  });

  it('ondersteunt "halve kilo"', () => {
    const parsed = parseItem('halve kilo rijst')!;
    expect(parsed.quantity.amount).toBe(500);
    expect(parsed.quantity.unit).toBe('g');
  });

  it('ondersteunt een eenheid achter de productnaam', () => {
    const parsed = parseItem('melk 2 liter')!;
    expect(parsed.name).toBe('melk');
    expect(parsed.quantity.amount).toBe(2000);
  });

  it('leest "2 x 1,5 l" als 2 flessen van 1,5 liter', () => {
    const parsed = parseItem('2 x 1,5 l cola')!;
    expect(parsed.name).toBe('cola');
    expect(parsed.quantity.amount).toBe(3000);
  });

  it('accepteert het symbool ×', () => {
    expect(parseItem('2× melk')!.quantity.originalAmount).toBe(2);
  });

  it('leest een product zonder hoeveelheid als 1 stuk', () => {
    const parsed = parseItem('brood')!;
    expect(parsed.quantity.originalAmount).toBe(1);
    expect(parsed.quantity.unit).toBe('st');
  });

  it('negeert een regel met alleen een hoeveelheid', () => {
    expect(parseItem('2 kg')).toBeNull();
  });

  it('verwijdert opsommingstekens aan het begin', () => {
    expect(parseItem('- brood')!.name).toBe('brood');
  });

  it('merkt de aanname bij een los getal zonder eenheid', () => {
    const parsed = parseItem('2 melk')!;
    expect(parsed.assumptions.some((a) => a.code === 'aantal-zonder-eenheid')).toBe(true);
  });

  it('waarschuwt bij een onbekende eenheid in losse invoer', () => {
    const parsed = parseItem('2 schoepjes poeder')!;
    expect(parsed.name).toBe('schoepjes poeder');
  });
});

describe('parseBulkText', () => {
  it('verwerkt de volledige voorbeeldinvoer', () => {
    const result = parseBulkText('melk, brood, cola, kipfilet, rijst, eieren');
    expect(result.items).toHaveLength(6);
    expect(result.ignored).toHaveLength(0);
    expect(result.items.map((i) => i.name)).toEqual(['melk', 'brood', 'cola', 'kipfilet', 'rijst', 'eieren']);
  });

  it('verwerkt een realistische boodschappenlijst', () => {
    const input = `2x melk
1 kg kipfilet
6 eieren
3 flessen cola
500 gram gehakt
2 pakken spaghetti
1 blik tomatensaus
1 kg aardappels
2 stuks paprika
brood`;
    const result = parseBulkText(input);
    expect(result.items).toHaveLength(10);
    expect(result.ignored).toHaveLength(0);
  });

  it('meldt onbruikbare regels in plaats van ze te negeren', () => {
    const result = parseBulkText('melk, 2 kg, brood');
    expect(result.items).toHaveLength(2);
    expect(result.ignored).toEqual(['2 kg']);
  });

  it('verwerkt de koppelteken-variant als scheidingsteken', () => {
    expect(parseBulkText('melk - brood - cola').items.map((i) => i.name)).toEqual(['melk', 'brood', 'cola']);
  });
});

describe('combineQuantities — dubbele ingrediënten', () => {
  it('telt 500 g en 1 kg op tot 1,5 kg', () => {
    const result = combineQuantities(makeQuantity(500, 'g'), makeQuantity(1, 'kg'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity.amount).toBe(1500);
      expect(result.quantity.unit).toBe('g');
    }
  });

  it('telt 250 ml en 750 ml op tot 1 liter', () => {
    const result = combineQuantities(makeQuantity(250, 'ml'), makeQuantity(750, 'ml'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quantity.amount).toBe(1000);
  });

  it('telt 2 en 3 stuks op tot 5 stuks', () => {
    const result = combineQuantities(defaultQuantity(2), defaultQuantity(3));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.quantity.amount).toBe(5);
  });

  it('meldt een conflict bij onverenigbare eenheden', () => {
    const result = combineQuantities(defaultQuantity(2), makeQuantity(500, 'g'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('dimension-conflict');
  });
});

describe('formatQuantity', () => {
  it('kiest automatisch een leesbare eenheid', () => {
    expect(formatQuantity(makeQuantity(1500, 'g'))).toBe('1,5 kilogram');
    expect(formatQuantity(makeQuantity(2000, 'ml'))).toBe('2 liter');
    expect(formatQuantity(defaultQuantity(1))).toBe('1 stuk');
  });

  it('gebruikt de juiste Nederlandse meervoudsvorm', () => {
    expect(formatQuantity(makeQuantity(2000, 'g'))).toBe('2 kilogram');
    expect(formatQuantity(makeQuantity(3000, 'ml'))).toBe('3 liter');
    expect(formatQuantity(defaultQuantity(5))).toBe('5 stuks');
    expect(formatQuantity(makeQuantity(2, 'pak'))).toBe('2 pakken');
  });
});
