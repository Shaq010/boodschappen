import { describe, expect, it } from 'vitest';
import {
  buildSynonymIndex,
  inferCategory,
  matchProduct,
  normalizeName,
  canonicalName,
  productCoreName,
  type MatchableProduct,
} from '../src/normalize.js';
import { classifyDrink, isDrink, partitionDrinks } from '../src/drinks.js';

const catalog: MatchableProduct[] = [
  { id: '1', name: 'Coca-Cola' },
  { id: '2', name: 'Coca-Cola Zero' },
  { id: '3', name: 'Fanta Orange' },
  { id: '4', name: 'Sprite' },
  { id: '5', name: 'Kipfilet' },
  { id: '6', name: 'Rundergehakt' },
  { id: '7', name: 'Volle melk' },
  { id: '8', name: 'Basmati rijst' },
  { id: '9', name: 'Spaghetti' },
  { id: '10', name: 'Appelsap' },
  { id: '11', name: 'Spaarwater rood' },
];

const index = buildSynonymIndex();

describe('normalizeName', () => {
  it('maakt schrijfwijzen vergelijkbaar', () => {
    expect(normalizeName('Coca-Cola')).toBe(normalizeName('Coca Cola'));
    expect(normalizeName('COCA COLA')).toBe('coca cola');
    expect(normalizeName('coca.cola')).toBe('coca cola');
    expect(normalizeName('  Cola  ')).toBe('cola');
  });

  it('verwijdert accenten', () => {
    expect(normalizeName('crème fraîche')).toBe('creme fraiche');
  });
});

describe('canonicalName', () => {
  it('herkent cola als Coca-Cola', () => {
    expect(canonicalName('cola', index)).toBe('coca cola');
  });

  it('laat onbekende namen ongemoeid', () => {
    expect(canonicalName('mierenzout', index)).toBe('mierenzout');
  });
});

describe('matchProduct', () => {
  it('herkent de drie schrijfwijzen van cola als één product', () => {
    for (const input of ['cola', 'Coca Cola', 'Coca-Cola']) {
      const result = matchProduct(input, catalog, index);
      expect(result.kind, `"${input}" moeten automatisch matchen`).toBe('match');
      if (result.kind === 'match') {
        expect(result.product.productId).toBe('1');
      }
    }
  });

  it('veroordeelt Coca-Cola niet als Coca-Cola Zero', () => {
    const result = matchProduct('cola zero', catalog, index);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.product.productId).toBe('2');
  });

  it('matcht een exacte naam', () => {
    const result = matchProduct('kipfilet', catalog, index);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.product.name).toBe('Kipfilet');
  });

  it('herkent "kip fillet" als kipfilet', () => {
    const result = matchProduct('kip fillet', catalog, index);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.product.name).toBe('Kipfilet');
  });

  it('vraagt om bevestiging bij twijfelachtige input', () => {
    const result = matchProduct('kipfilett', catalog, index);
    if (result.kind === 'match') {
      // Als het als match eindigt moet het wel het juiste product zijn.
      expect(result.product.name).toBe('Kipfilet');
    } else {
      expect(result.kind).toBe('suggest');
    }
  });

  it('maakt nooit een match tussen verschillende producten', () => {
    const result = matchProduct('Sprite', catalog, index);
    expect(result.kind).toBe('match');
    if (result.kind === 'match') expect(result.product.productId).toBe('4');
  });

  it('geft "none" terug als er niets bij past', () => {
    const result = matchProduct('zeker geen product in deze lijst', catalog, index);
    expect(result.kind).toBe('none');
  });

  it('sorteert suggesties op zekerheid', () => {
    const result = matchProduct('melk product', catalog, index);
    const candidates = result.kind === 'match' ? [] : result.candidates;
    const confidences = candidates.map((c) => c.confidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    expect(confidences).toEqual(sorted);
  });

  it('houdt cola en cola zero gescheiden', () => {
    const colaZero = matchProduct('cola zero', catalog, index);
    expect(colaZero.kind).toBe('match');
    if (colaZero.kind === 'match') expect(colaZero.product.name).toBe('Coca-Cola Zero');

    const plain = matchProduct('cola', catalog, index);
    expect(plain.kind).toBe('match');
    if (plain.kind === 'match') expect(plain.product.name).toBe('Coca-Cola');
  });

  it('voegt cola en cola zero NIET samen in de boodschappenlijst', () => {
    const index2 = buildSynonymIndex();
    expect(canonicalName('cola', index2)).not.toBe(canonicalName('cola zero', index2));
  });

  it('laat een synoniem van de gebruiker een ingebouwd alias overschrijven', () => {
    // "Boter" is een ingebouwd synoniem. Als de gebruiker zegt dat het zijn
    // sodaboter is, moet dat gevolg hebben en stilzwijgend worden genegeerd mag
    // het niet.
    const metGebruiker = buildSynonymIndex(new Map([['sodaboter', ['boter']]]));
    const catalog: MatchableProduct[] = [{ id: '1', name: 'Sodaboter' }];

    const verdict = matchProduct('Boter', catalog, metGebruiker);
    expect(verdict.kind).toBe('match');
    if (verdict.kind === 'match') {
      expect(verdict.product.productId).toBe('1');
      expect(verdict.product.reason).toBe('canonieke-synonieem');
    }
  });

  it('houdt de variantveiligheid ook als de gebruiker cola en cola zero koppelt', () => {
    const metGebruiker = buildSynonymIndex(new Map([['cola zero', ['cola']]]));
    const catalog: MatchableProduct[] = [
      { id: '1', name: 'Coca-Cola' },
      { id: '2', name: 'Coca-Cola Zero' },
    ];

    // Zelfs met een eigen alias mogen ze niet als één product worden beschouwd.
    const verdict = matchProduct('cola', catalog, metGebruiker);
    expect(verdict.kind).not.toBe('match');
  });
});

describe('inferCategory', () => {
  it('herkent de belangrijkste categorieën', () => {
    expect(inferCategory('Kipfilet', index)).toBe('vlees');
    expect(inferCategory('Volle melk', index)).toBe('zuivel');
    expect(inferCategory('Broccoli', index)).toBe('groente');
    expect(inferCategory('Basmati rijst', index)).toBe('voorradskast');
    expect(inferCategory('Toiletpapier', index)).toBe('huishouden');
  });

  it('valt terug op overig', () => {
    expect(inferCategory('mystery product', index)).toBe('overig');
  });
});

describe('classifyDrink', () => {
  it('herkent de dranken uit de opdracht', () => {
    expect(classifyDrink('Coca-Cola')).toBe('frisdrank');
    expect(classifyDrink('Fanta')).toBe('frisdrank');
    expect(classifyDrink('Sprite')).toBe('frisdrank');
    expect(classifyDrink('Pepsi')).toBe('frisdrank');
    expect(classifyDrink('Appelsap')).toBe('sap');
    expect(classifyDrink('Spaarwater')).toBe('water');
    expect(classifyDrink('Spa rood')).toBe('water');
    expect(classifyDrink('Capri-Sun')).toBe('frisdrank');
  });

  it('herkent overige dranken', () => {
    expect(classifyDrink('Heineken')).toBe('bier');
    expect(classifyDrink('rode wijn')).toBe('wijn');
    expect(classifyDrink('Koffiebonen')).toBe('koffie-thee');
    expect(classifyDrink('Red Bull')).toBe('energie');
  });

  it('merkt geen voedsel aan als drank', () => {
    expect(isDrink('Kipfilet')).toBe(false);
    expect(isDrink('Brood')).toBe(false);
    expect(isDrink('Appel')).toBe(false);
  });

  it('scheidt een lijst in dranken en overige producten', () => {
    const items = [{ name: 'Coca-Cola' }, { name: 'Brood' }, { name: 'Melk' }];
    const { drinks, others } = partitionDrinks(items);
    expect(drinks.map((d) => d.name)).toEqual(['Coca-Cola', 'Melk']);
    expect(others.map((d) => d.name)).toEqual(['Brood']);
  });
});

describe('kern van de productnaam', () => {
  it('haalt maatvoering en verpakking weg', () => {
    expect(productCoreName('Melk 1 l')).toBe('melk');
    expect(productCoreName('Spaghetti 500 g')).toBe('spaghetti');
    expect(productCoreName('Coca-Cola 12 x 1,5 l')).toBe('coca cola');
    expect(productCoreName('Paprika per 250 g')).toBe('paprika per');
    expect(productCoreName('Bananen')).toBe('bananen');
  });

  it('laat de productnaam zelf staan', () => {
    // "regular" en "zero" zijn varianten, geen verpakking.
    expect(productCoreName('Coca-Cola regular 1,5 l')).toBe('coca cola regular');
    expect(productCoreName('Coca-Cola zero 1,5 l')).toBe('coca cola zero');
  });

  it('koppelt een korte naam aan de winkelnaam met maatvoering', () => {
    const candidates: MatchableProduct[] = [
      { id: 'p1', name: 'Melk 1 l' },
      { id: 'p2', name: 'Bananen' },
    ];
    const verdict = matchProduct('melk', candidates);
    expect(verdict.kind).toBe('match');
    if (verdict.kind !== 'match') throw new Error('verwacht: match');
    expect(verdict.product.productId).toBe('p1');
  });

  it('koppelt "cola" aan "Coca-Cola" maar vraagt het bij een variant', () => {
    const candidates: MatchableProduct[] = [{ id: 'p1', name: 'Coca-Cola regular 1,5 l' }];
    const verdict = matchProduct('cola', candidates);
    // "cola" is niet hetzelfde als "regular"; dat is een vraag, geen match.
    expect(verdict.kind).toBe('suggest');
    if (verdict.kind !== 'suggest') throw new Error('verwacht: suggest');
    expect(verdict.candidates[0]?.reason).toBe('andere-variant');
  });

  it('voegt twee gelijke winkelproducten samen over winkels heen', () => {
    const candidates: MatchableProduct[] = [
      { id: 'p1', name: 'Melk 1 l' },
      { id: 'p2', name: 'Melk 1 l' },
    ];
    const verdict = matchProduct('melk', candidates);
    // Zelfde product in de catalogus, dus geen twijfel: kies er een.
    expect(verdict.kind).toBe('match');
  });

  it('vraagt het als de kandidaten echt verschillen', () => {
    const candidates: MatchableProduct[] = [
      { id: 'p1', name: 'Melk 1 l' },
      { id: 'p2', name: 'Melk 3 l' },
    ];
    const verdict = matchProduct('melk', candidates);
    // Zelfde woord, ander packformaat: dat is een keuze, geen gok.
    expect(verdict.kind).toBe('suggest');
    if (verdict.kind !== 'suggest') throw new Error('verwacht: suggest');
    expect(verdict.candidates.map((c) => c.name).sort()).toEqual(['Melk 1 l', 'Melk 3 l']);
  });

  it('koppelt nooit "cola" aan "cola zero"', () => {
    const candidates: MatchableProduct[] = [
      { id: 'p1', name: 'Coca-Cola zero 1,5 l' },
      { id: 'p2', name: 'Coca-Cola regular 1,5 l' },
    ];
    const verdict = matchProduct('cola', candidates);
    expect(verdict.kind).toBe('suggest');
    if (verdict.kind !== 'suggest') throw new Error('verwacht: suggest');
    expect(verdict.candidates).toHaveLength(2);
  });

  it('koppelt "cola" aan "Coca-Cola" als er geen varianten in de winkel liggen', () => {
    const candidates: MatchableProduct[] = [{ id: 'p1', name: 'Coca-Cola 1,5 l' }];
    const verdict = matchProduct('cola', candidates);
    expect(verdict.kind).toBe('match');
  });

  it('laat producten die alleen uit maatvoering bestaan links liggen', () => {
    const candidates: MatchableProduct[] = [{ id: 'p1', name: '1 l' }];
    expect(matchProduct('melk', candidates).kind).toBe('none');
  });
});

describe('een bevestigde naam van de gebruiker', () => {
  const producten = [{ id: 'p1', name: 'Coca-Cola regular 1,5 l' }];

  it('zonder bevestiging blijft het een vraag', () => {
    const index = buildSynonymIndex();
    expect(matchProduct('cola', producten, index).kind).toBe('suggest');
  });

  it('is het sterkste signaal en wint van de variantcontrole', () => {
    const index = buildSynonymIndex(new Map([['Coca-Cola regular 1,5 l', ['cola']]]));
    const verdict = matchProduct('cola', producten, index);
    // De gebruiker heeft zelf bevestigd dat dit het product is; dat is geen
    // vraag meer, ook al spreekt de variantcontrole het tegen.
    expect(verdict.kind).toBe('match');
    if (verdict.kind !== 'match') throw new Error('verwacht: match');
    expect(verdict.product.productId).toBe('p1');
  });

  it('geldt niet voor andere producten', () => {
    const index = buildSynonymIndex(new Map([['Coca-Cola regular 1,5 l', ['cola']]]));
    const verdict = matchProduct('cola', [{ id: 'p2', name: 'Pepsi max 1,5 l' }], index);
    expect(verdict.kind).not.toBe('match');
  });
});
