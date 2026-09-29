/**
 * Nederlandse teksten en presentatiehulpjes voor de interface.
 *
 * Alle teksten staan hier zodat de app consistent Nederlandse taal gebruikt en
 * de gebruiker niets in het Engels tegenkomt.
 */

import type { Weekday } from './menu.js';
import { WEEKDAY_LABELS } from './menu.js';
import type { ProductCategory } from './normalize.js';
import { CATEGORY_LABELS } from './normalize.js';
import type { DrinkKind } from './drinks.js';
import { DRINK_KIND_LABELS } from './drinks.js';
import type { OfferKind } from './offers.js';

export const CATEGORY_EMOJI: Record<ProductCategory, string> = {
  groente: '🥦',
  fruit: '🍎',
  zuivel: '🥛',
  vlees: '🥩',
  vis: '🐟',
  brood: '🍞',
  voorradskast: '🥫',
  snacks: '🍫',
  drank: '🥤',
  dieet: '🥗',
  huishouden: '🧽',
  overig: '🛒',
};

export const OFFER_KIND_LABELS: Record<OfferKind, string> = {
  price_drop: 'Prijsverlaging',
  multipack: 'Multipack',
  second_half: '2e halve prijs',
  loyalty: 'Met klantenkaart',
  min_quantity: 'Vanaf meerdere',
  bundle: 'Bundel',
  per_volume: 'Per liter voordeliger',
  cashback: 'Cashback',
};

export const APP_NAME = 'Boodschappen';
export const APP_TAGLINE = 'Slim boodschappen met weekmenu en prijsvergelijking';

export function weekdayLabel(day: Weekday | string): string {
  return WEEKDAY_LABELS[day as Weekday] ?? String(day);
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as ProductCategory] ?? 'Overig';
}

export function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category as ProductCategory] ?? '🛒';
}

export function drinkKindLabel(kind: string): string {
  return DRINK_KIND_LABELS[kind as DrinkKind] ?? 'Drank';
}

export function offerKindLabel(kind: OfferKind | string): string {
  return OFFER_KIND_LABELS[kind as OfferKind] ?? 'Aanbieding';
}

/** Begroeting op basis van het tijdstip in Nederland. */
export function greeting(date: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false }).format(date),
  );
  if (hour < 5) return 'Goedenavond';
  if (hour < 12) return 'Goedemorgen';
  if (hour < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

const DATETIME_NL = new Intl.DateTimeFormat('nl-NL', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Amsterdam',
});

const DATE_NL = new Intl.DateTimeFormat('nl-NL', {
  dateStyle: 'full',
  timeZone: 'Europe/Amsterdam',
});

const TIME_NL = new Intl.DateTimeFormat('nl-NL', {
  timeStyle: 'short',
  timeZone: 'Europe/Amsterdam',
});

/** "Laatst bijgewerkt: 28 september 2026 om 14:32" */
export function lastUpdatedLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Laatst bijgewerkt: nog niet opgehaald';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Laatst bijgewerkt: onbekend';
  const ageMs = now.getTime() - date.getTime();
  const ageMinutes = Math.round(ageMs / 60_000);
  const absolute = `Laatst bijgewerkt: ${DATETIME_NL.format(date)}`;
  if (ageMinutes < 1) return `${absolute} (zojuist)`;
  if (ageMinutes < 60) return `${absolute} (${ageMinutes} ${ageMinutes === 1 ? 'minuut' : 'minuten'} geleden)`;
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 48) return `${absolute} (${ageHours} ${ageHours === 1 ? 'uur' : 'uur'} geleden)`;
  return absolute;
}

export function formatDateNl(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_NL.format(date);
}

export function formatTimeNl(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return TIME_NL.format(date);
}

/** Geldigheidsperiode in het Nederlands, bv. "t/m 30 september". */
export function validityLabel(from: string | null, until: string | null): string {
  const fmt = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'long' }).format(date);
  };
  if (from && until) return `Geldig ${fmt(from)} t/m ${fmt(until)}`;
  if (until) return `Geldig t/m ${fmt(until)}`;
  if (from) return `Geldig vanaf ${fmt(from)}`;
  return 'Geldigheidsperiode onbekend';
}

/** Is een aanbieding vandaag (in NL-tijd) nog geldig? */
export function isValidToday(from: string | null, until: string | null, now: Date = new Date()): boolean {
  const nowMs = now.getTime();
  if (from && new Date(from).getTime() > nowMs) return false;
  if (until) {
    // Geldig t/m het einde van de genoemde dag.
    const untilDate = new Date(until);
    const endOfDay = new Date(
      untilDate.getFullYear(),
      untilDate.getMonth(),
      untilDate.getDate(),
      23,
      59,
      59,
      999,
    );
    if (endOfDay.getTime() < nowMs) return false;
  }
  return true;
}

export function pluralizeNl(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}

export function itemCountLabel(count: number): string {
  return `${count} ${pluralizeNl(count, 'product', 'producten')}`;
}

export function euro(value: number, decimals = 2): string {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function euroPerUnit(value: number | null): string {
  if (value == null) return '—';
  return `${new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} per eenheid`;
}
