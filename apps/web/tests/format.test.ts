import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatDate,
  formatMoney,
  formatNumber,
  formatQuantity,
  greeting,
  listSentence,
  offerKindLabel,
  sourceStatusLabel,
} from '../src/lib/format.js';

describe('bedragen', () => {
  it('toont eurobedragen met Nederlandse notatie', () => {
    // 1234,50 -> "€ 1.234,50", met de niet-afbreekbare spatie die Intl gebruikt.
    expect(formatMoney(1234.5)).toBe('€\u00A01.234,50');
  });

  it('laat lege prijzen leeg in plaats van 0', () => {
    // Dit is belangrijk: "€ 0,00" zou een verzonnen prijs suggereren.
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
  });

  it('maakt centen er helemaal van', () => {
    expect(formatMoney(2.25)).toBe('€\u00A02,25');
  });
});

describe('aantallen', () => {
  it('gebruikt een komma als decimaalteken', () => {
    expect(formatNumber(1.5)).toBe('1,5');
  });

  it('schrijft eenheden erachter', () => {
    expect(formatQuantity(1.5, 'l')).toBe('1,5 l');
  });
});

describe('tijd', () => {
  it('vormt ouderdom van seconden naar tekst', () => {
    expect(formatAge(10)).toBe('zojuist');
    expect(formatAge(60)).toBe('1 minuut geleden');
    expect(formatAge(120)).toBe('2 minuten geleden');
    expect(formatAge(3600)).toBe('1 uur geleden');
    expect(formatAge(86_400)).toBe('gisteren');
    expect(formatAge(172_800)).toBe('2 dagen geleden');
    expect(formatAge(null)).toBe('onbekend');
  });

  it('laat onbekende data zien in plaats van "Invalid Date"', () => {
    expect(formatDate('geen datum')).toBe('onbekend');
    expect(formatDate(null)).toBe('—');
  });
});

describe('begroeting', () => {
  it('volgt het uur van de dag', () => {
    expect(greeting(new Date('2026-01-01T08:00:00'))).toBe('Goedemorgen');
    expect(greeting(new Date('2026-01-01T14:00:00'))).toBe('Goedemiddag');
    expect(greeting(new Date('2026-01-01T20:00:00'))).toBe('Goede avond');
  });
});

describe('opsommingen', () => {
  it('maakt er een Nederlandse lijst van', () => {
    expect(listSentence([])).toBe('');
    expect(listSentence(['melk'])).toBe('melk');
    expect(listSentence(['melk', 'brood'])).toBe('melk en brood');
    expect(listSentence(['melk', 'brood', 'kaas'])).toBe('melk, brood en kaas');
  });
});

describe('labels', () => {
  it('vertaalt aanbiedingssoorten', () => {
    expect(offerKindLabel('second_half')).toBe('Tweede halve prijs');
    expect(offerKindLabel('loyalty')).toBe('Alleen met klantenkaart');
    // Onbekend soort blijft leesbaar in plaats van weg te vallen.
    expect(offerKindLabel('iets-nieuws')).toBe('iets-nieuws');
  });

  it('vertaalt bronstatussen', () => {
    expect(sourceStatusLabel('connected')).toBe('Gekoppeld');
    expect(sourceStatusLabel('not_configured')).toBe('Niet gekoppeld');
    // Een bewust uitgezet netwerk is geen fout en moet dat ook zo lezen.
    expect(sourceStatusLabel('network_disabled')).toBe('Netwerk staat uit');
  });
});
