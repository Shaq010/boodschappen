/**
 * Nederlandse weergave.
 *
 * Alle bedragen, datums en teksten lopen via deze ene plek, zodat de
 * app overal consistent spreekt en nooit engelse conventies laat zien.
 */

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const euroRounded = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const decimal = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' });
const weekdayOnly = new Intl.DateTimeFormat('nl-NL', { weekday: 'long' });

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return euro.format(value);
}

/** Bedragen zonder centen, voor overzichten met veel getallen. */
export function formatMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return euroRounded.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return decimal.format(value);
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return euro.format(cents / 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'nooit';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'onbekend';
  return dateTime.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'onbekend';
  return dateOnly.format(date);
}

export function formatWeekday(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return weekdayOnly.format(date);
}

/** "3 minuten geleden", "2 uur geleden", "gisteren". */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'onbekend';
  if (seconds < 60) return 'zojuist';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minuut' : 'minuten'} geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'uur' : 'uur'} geleden`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'gisteren';
  return `${days} dagen geleden`;
}

export const DAY_LABELS: Record<string, string> = {
  maandag: 'maandag',
  dinsdag: 'dinsdag',
  woensdag: 'woensdag',
  donderdag: 'donderdag',
  vrijdag: 'vrijdag',
  zaterdag: 'zaterdag',
  zondag: 'zondag',
};

export const WEEKDAY_ORDER = [
  'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag',
] as const;

export function dayLabel(day: string): string {
  return DAY_LABELS[day] ?? day;
}

/** Begroeting op basis van het uur. */
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'Goede nacht';
  if (hour < 12) return 'Goedemorgen';
  if (hour < 18) return 'Goedemiddag';
  return 'Goede avond';
}

/** Hoeveelheid met eenheid, bv. "1,5 l" of "3 st". */
export function formatQuantity(amount: number, unit: string): string {
  return `${formatNumber(amount)} ${unit}`;
}

const KIND_LABELS: Record<string, string> = {
  price_drop: 'Prijsverlaging',
  multipack: 'Multipack',
  second_half: 'Tweede halve prijs',
  loyalty: 'Alleen met klantenkaart',
  min_quantity: 'Vanaf meerdere stuks',
  bundle: 'Bundelprijs',
  per_volume: 'Korting per liter',
  cashback: 'Cashback',
};

export function offerKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const STATUS_LABELS: Record<string, string> = {
  connected: 'Gekoppeld',
  not_configured: 'Niet gekoppeld',
  network_disabled: 'Netwerk staat uit',
  error: 'Fout',
  rate_limited: 'Te veel verzoeken',
  syncing: 'Bezig met ophalen',
};

export function sourceStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Join van lijsten: "melk, brood en kaas". */
export function listSentence(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(', ')} en ${values[values.length - 1]!}`;
}
