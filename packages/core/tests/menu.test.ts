import { describe, expect, it } from 'vitest';
import {
  WEEKDAYS,
  addDays,
  currentWeekday,
  mergeIngredients,
  startOfIsoWeek,
  todayIso,
  weekdayOfIsoDate,
  WEEKDAY_LABELS,
  type MergeableIngredient,
} from '../src/menu.js';
import { defaultQuantity, formatQuantity, makeQuantity } from '../src/units.js';

function ing(id: string, name: string, quantity = defaultQuantity(1), extra: Partial<MergeableIngredient> = {}): MergeableIngredient {
  return { id, name, quantity, ...extra };
}

describe('weekdagen', () => {
  it('heeft alle zeven dagen in de Nederlandse volgorde', () => {
    expect(WEEKDAYS).toEqual(['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']);
    expect(WEEKDAY_LABELS.maandag).toBe('Maandag');
    expect(WEEKDAY_LABELS.zondag).toBe('Zondag');
  });

  it('berekent de weekday van een ISO-datum', () => {
    expect(weekdayOfIsoDate('2026-09-28')).toBe('maandag');
    expect(weekdayOfIsoDate('2026-10-04')).toBe('zondag');
    expect(weekdayOfIsoDate('2026-01-01')).toBe('donderdag');
  });

  it('vindt het begin van de week (maandag)', () => {
    expect(startOfIsoWeek('2026-09-28')).toBe('2026-09-28');
    expect(startOfIsoWeek('2026-10-04')).toBe('2026-09-28');
    expect(startOfIsoWeek('2026-09-30')).toBe('2026-09-28');
  });

  it('kan dagen optellen', () => {
    expect(addDays('2026-09-28', 3)).toBe('2026-10-01');
  });

  it('geeft een geldige datum en weekday terug', () => {
    expect(todayIso(new Date('2026-09-28T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(WEEKDAYS).toContain(currentWeekday());
  });
});

describe('mergeIngredients — automatische boodschappenlijst', () => {
  it('voegt dubbele ingrediënten met dezelfde eenheid samen', () => {
    const result = mergeIngredients([
      ing('a', 'gehakt', makeQuantity(500, 'g')),
      ing('b', 'gehaakt', makeQuantity(1, 'kg')),
    ]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.quantity.amount).toBe(1500);
    expect(result.merged[0]?.sources).toHaveLength(2);
  });

  it('herkent "cola" en "Coca-Cola" als hetzelfde product', () => {
    const result = mergeIngredients([
      ing('a', 'Coca-Cola', defaultQuantity(2)),
      ing('b', 'cola', defaultQuantity(1)),
    ]);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.quantity.originalAmount).toBe(3);
  });

  it('herkent "kipfilet" en "kip fillet" als hetzelfde product', () => {
    const result = mergeIngredients([
      ing('a', 'kipfilet', makeQuantity(500, 'g')),
      ing('b', 'kip fillet', makeQuantity(500, 'g')),
    ]);
    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.quantity.amount).toBe(1000);
  });

  it('houdt verschillende producten gescheiden', () => {
    const result = mergeIngredients([
      ing('a', 'rijst', makeQuantity(1, 'kg')),
      ing('b', 'broccoli', makeQuantity(300, 'g')),
      ing('c', 'kipfilet', makeQuantity(500, 'g')),
    ]);
    expect(result.merged).toHaveLength(3);
  });

  it('meldt een conflict in plaats van stil te kiezen', () => {
    const result = mergeIngredients([
      ing('a', 'gehakt', makeQuantity(500, 'g')),
      ing('b', 'gehakt', defaultQuantity(2)),
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged[0]?.conflict).toBe(true);
    expect(result.conflicts[0]?.message).toContain('verschillende eenheden');
  });

  it('verwerkt het voorbeeld uit de opdracht (bolognese + kip met rijst)', () => {
    // Maandag: Spaghetti bolognese -> 500 g gehakt, 1 pak spaghetti, tomatensaus
    // Dinsdag: Kip met rijst en broccoli -> 500 g kipfilet, 1 kg rijst, broccoli
    const result = mergeIngredients([
      ing('m1', 'gehakt', makeQuantity(500, 'g')),
      ing('m2', 'spaghetti', makeQuantity(1, 'pak')),
      ing('m3', 'tomatensaus', defaultQuantity(1)),
      ing('t1', 'kipfilet', makeQuantity(500, 'g')),
      ing('t2', 'rijst', makeQuantity(1, 'kg')),
      ing('t3', 'broccoli', makeQuantity(1, 'st')),
    ]);
    expect(result.merged).toHaveLength(6);
    expect(result.conflicts).toHaveLength(0);
    const names = result.merged.map((m) => m.name);
    expect(names).toContain('gehakt');
    expect(names).toContain('spaghetti');
    expect(names).toContain('kipfilet');
  });

  it('laat zien dat een product al in huis is', () => {
    const result = mergeIngredients([
      ing('a', 'melk', makeQuantity(1, 'l'), { inPantry: true }),
      ing('b', 'brood', defaultQuantity(1)),
    ]);
    const melk = result.merged.find((m) => m.name === 'melk')!;
    const brood = result.merged.find((m) => m.name === 'brood')!;
    expect(melk.inPantry).toBe(true);
    expect(brood.inPantry).toBe(false);
  });

  it('verwerkt een weekmenu met dubbele ingrediënten over meerdere dagen', () => {
    // Woensdag spaghetti, donderdag spaghetti: 2 pakken spaghetti totaal.
    const result = mergeIngredients([
      ing('wo', 'spaghetti', makeQuantity(1, 'pak')),
      ing('do', 'spaghetti', makeQuantity(1, 'pak')),
      ing('wo2', 'tomatensaus', defaultQuantity(1)),
      ing('do2', 'tomatensaus', defaultQuantity(1)),
    ]);
    expect(result.merged).toHaveLength(2);
    const spaghetti = result.merged.find((m) => m.name === 'spaghetti')!;
    expect(formatQuantity(spaghetti.quantity)).toBe('2 pakken');
  });

  it('wijst de juiste categorie toe', () => {
    const result = mergeIngredients([ing('a', 'kipfilet', makeQuantity(500, 'g'))]);
    expect(result.merged[0]?.category).toBe('vlees');
  });
});
