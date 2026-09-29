/**
 * Aanbiedingen.
 *
 * Alleen aanbiedingen uit een gekoppelde bron. Zonder bron staat er een
 * uitleg, géén verzonnen aanbod: dat zou erger zijn dan niets tonen.
 */

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api_, type OfferRow, type StoreId } from '../lib/api.js';
import { useLoadable, useSources } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StoreChip, StatusPill } from '../components/ui.js';
import { formatDate, formatMoney, listSentence, offerKindLabel } from '../lib/format.js';

const STORE_FILTERS: Array<{ id: StoreId | 'all'; label: string }> = [
  { id: 'all', label: 'Alle winkels' },
  { id: 'lidl', label: 'Lidl' },
  { id: 'albert_heijn', label: 'Albert Heijn' },
  { id: 'dirk', label: 'Dirk' },
  { id: 'kruidvat', label: 'Kruidvat' },
];

export function OffersPage() {
  usePageTitle('Aanbiedingen');
  const sources = useSources();
  const [filter, setFilter] = useState<StoreId | 'all'>('all');
  const [search, setSearch] = useState('');
  const offers = useLoadable(() => api_.offers(), []);

  const rows = useMemo(() => {
    const all = offers.data?.offers ?? [];
    return all
      .filter((offer) => filter === 'all' || offer.storeId === filter)
      .filter((offer) => offer.title.toLowerCase().includes(search.trim().toLowerCase()))
      .sort(sortByDiscount);
  }, [offers.data, filter, search]);

  const totalSavings = rows.reduce((sum, offer) => sum + savingsOf(offer), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Aanbiedingen</h1>
        <p className="mt-1 text-slate-600">
          {rows.length > 0
            ? `${rows.length} aanbieding(en) · samen ${formatMoney(totalSavings)} korting.`
            : 'Alle aanbiedingen uit je gekoppelde bronnen.'}
        </p>
      </header>

      {!sources.hasLivePricing && !sources.loading ? (
        <Notice kind="info" title="Nog geen bron gekoppeld">
          <p>
            De vier winkels bieden geen openbare API voor prijzen, en hun websites verbieden geautomatiseerd
            ophalen. Zonder officiële koppeling blijft deze pagina leeg — er worden geen bedragen getoond die
            niet uit een bron komen.
          </p>
          <p className="mt-2">Koppel een bron in Instellingen, of vul prijzen zelf in.</p>
        </Notice>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="zoeken" className="mb-1 block text-sm font-medium text-slate-800">
              Zoeken
            </label>
            <input
              id="zoeken"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="bijvoorbeeld melk"
              className="w-full rounded-lg border border-slate-300 p-2.5"
            />
          </div>

          <div>
            <label htmlFor="winkel-filter" className="mb-1 block text-sm font-medium text-slate-800">
              Winkel
            </label>
            <select
              id="winkel-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as StoreId | 'all')}
              className="rounded-lg border border-slate-300 p-2.5"
            >
              {STORE_FILTERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Button variant="secondary" onClick={() => { offers.reload(); sources.reload(); }}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Vernieuwen
          </Button>
        </div>
      </Card>

      {offers.loading ? <Spinner label="Aanbiedingen laden" /> : null}
      {offers.error ? <Notice kind="error" title="Laden mislukt">{offers.error}</Notice> : null}

      {!offers.loading && rows.length === 0 && offers.error === null ? (
        <Card>
          <EmptyState title="Geen aanbiedingen gevonden">
            <p>
              {sources.hasLivePricing
                ? 'De gekoppelde bron leverde geen aanbiedingen op die hier passen. Probeer te vernieuwen of de zoekterm te wijzigen.'
                : 'Er is nog niets om te tonen. Zie hierboven wat je kunt doen.'}
            </p>
          </EmptyState>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((offer) => (
            <li key={offer.id}>
              <OfferCard offer={offer} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OfferCard({ offer }: { offer: OfferRow }) {
  const savings = savingsOf(offer);
  const conditions = describeConditions(offer);

  return (
    <article className="card flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <StoreChip name={offer.storeName} small />
        {savings > 0 ? <StatusPill status="ok" label={`-${formatMoney(savings)}`} /> : null}
      </div>

      <h2 className="mt-2 font-semibold text-slate-900">{offer.title}</h2>
      {offer.description ? <p className="mt-0.5 text-sm text-slate-600">{offer.description}</p> : null}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        {offer.offerPriceCents !== null ? (
          <span className="text-xl font-semibold text-slate-900">{formatMoney(offer.offerPriceCents / 100)}</span>
        ) : null}
        {offer.regularPriceCents !== null ? (
          <span className="text-sm text-slate-500 line-through">{formatMoney(offer.regularPriceCents / 100)}</span>
        ) : null}
        <span className="text-xs text-slate-500">{offerKindLabel(offer.kind)}</span>
      </div>

      {offer.packDescription ? <p className="mt-1 text-sm text-slate-600">{offer.packDescription}</p> : null}

      {conditions.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-amber-900">
          {conditions.map((condition) => (
            <li key={condition} className="rounded-md bg-amber-50 px-2 py-1">
              {condition}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-auto pt-2 text-xs text-slate-500">
        {offer.validUntil ? `Geldig tot ${formatDate(offer.validUntil)}` : 'Zonder einddatum opgegeven'}
        {offer.sourceName ? ` · via ${offer.sourceName}` : ''}
      </p>
    </article>
  );
}

function savingsOf(offer: OfferRow): number {
  if (offer.offerPriceCents === null || offer.regularPriceCents === null) return 0;
  const saved = offer.regularPriceCents - offer.offerPriceCents;
  return saved > 0 ? saved / 100 : 0;
}

/** Grote korting eerst. */
function sortByDiscount(a: OfferRow, b: OfferRow): number {
  return savingsOf(b) - savingsOf(a);
}

function describeConditions(offer: OfferRow): string[] {
  // De sleutels hier moeten overeenkomen met wat de API bewaart. De adapter
  // onkent en verwijdert elke onbekende voorwaarde, dus een verkeerde sleutel
  // hier leidt er stil toe dat er niets getoond wordt — en een kaartprijs
  // zou dan als gewone prijs ogen.
  const conditions = (offer.conditions ?? {}) as Record<string, unknown>;
  const notes: string[] = [];

  if (conditions.requiresLoyaltyCard === true) {
    const cardName = typeof conditions.loyaltyCardName === 'string' ? conditions.loyaltyCardName.trim() : '';
    notes.push(cardName ? `Alleen met ${cardName}.` : 'Alleen met klantenkaart.');
  }
  if (typeof conditions.discountPercent === 'number' && conditions.discountPercent > 0) {
    notes.push(`${Math.round(conditions.discountPercent)}% korting met de kaart.`);
  }
  if (typeof conditions.minQuantity === 'number' && conditions.minQuantity > 1) {
    notes.push(`Vanaf ${conditions.minQuantity} stuks.`);
  }
  if (typeof conditions.maxPerPerson === 'number') {
    notes.push(`Maximaal ${conditions.maxPerPerson} per persoon.`);
  }
  if (typeof conditions.bundleSize === 'number' && typeof conditions.bundlePrice === 'number') {
    notes.push(`${conditions.bundleSize} voor € ${conditions.bundlePrice.toFixed(2).replace('.', ',')}.`);
  }
  if (typeof conditions.secondUnitDiscount === 'number' && conditions.secondUnitDiscount > 0) {
    const tweede = Math.round(conditions.secondUnitDiscount * 100);
    notes.push(
      tweede >= 100 ? 'Tweede artikel gratis.' : `Tweede artikel voor ${tweede}% van de prijs.`,
    );
  }
  if (typeof conditions.instantSavings === 'number' && conditions.instantSavings > 0) {
    notes.push(
      `€ ${conditions.instantSavings.toFixed(2).replace('.', ',')} korting bij afrekenen (cashback).`,
    );
  }
  if (typeof conditions.giftValue === 'number' && conditions.giftValue > 0) {
    notes.push(`Waarde cadeau € ${conditions.giftValue.toFixed(2).replace('.', ',')}.`);
  }
  if (offer.description) notes.push(offer.description);

  return notes.length > 0 ? [listSentence(notes)] : [];
}
