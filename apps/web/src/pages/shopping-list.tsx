/**
 * Boodschappenlijst: de kern van de app.
 *
 * Bevat:
 *  - de lijst met afvinken, per regel de beste prijs en eventuele voorwaarden;
 *  - de bulkparser met een preview die je eerst moet nakijken;
 *  - de winkelsamenstelling: alles bij één winkel, de goedkoopste combinatie
 *    en de oplossing met zo min mogelijk winkels.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ListPlus, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import { api_, ApiError, type ItemDetail, type ParsePreviewItem, type StorePlan } from '../lib/api.js';
import { useActiveList, useLoadable, useSources } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StoreChip, StatusPill } from '../components/ui.js';
import { formatMoney, listSentence } from '../lib/format.js';

export function ShoppingListPage() {
  usePageTitle('Boodschappenlijst');
  const { listId, lists, createList, creating, setListId, reloadLists } = useActiveList();
  const sources = useSources();
  const [bulkOpen, setBulkOpen] = useState(false);

  const detail = useLoadable(() => (listId ? api_.list(listId) : Promise.resolve(null)), [listId]);
  const [optimization, setOptimization] = useState<Awaited<ReturnType<typeof api_.optimize>> | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [optLoading, setOptLoading] = useState(false);

  useEffect(() => {
    if (!listId) {
      setOptimization(null);
      return;
    }
    let active = true;
    setOptLoading(true);
    setOptError(null);
    api_
      .optimize(listId)
      .then((result) => {
        if (active) setOptimization(result);
      })
      .catch((error: unknown) => {
        if (active) setOptError(error instanceof ApiError ? error.userMessage : 'Optimalisatie mislukt.');
      })
      .finally(() => {
        if (active) setOptLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listId, detail.data]);

  const items = detail.data?.items ?? [];
  const open = items.filter((item) => !item.checked);
  const done = items.filter((item) => item.checked);

  if (!listId) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold text-slate-900">Boodschappenlijst</h1>
        <Card>
          <CardTitle>Nog geen lijst</CardTitle>
          {lists.length > 0 ? (
            <ul className="space-y-2">
              {lists.map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    onClick={() => setListId(list.id)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="font-medium">{list.name}</span>
                    <span className="block text-sm text-slate-600">
                      {list.itemCount} producten, {list.checkedCount} afgevinkt
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Je hebt nog geen lijst">
              <p>Maak een lijst aan en vul hem met losse tekst of producten per stuk.</p>
            </EmptyState>
          )}
          <div className="mt-3">
            <Button
              onClick={async () => {
                const id = await createList();
                if (id) setListId(id);
              }}
              disabled={creating}
            >
              <ListPlus aria-hidden="true" className="h-4 w-4" />
              Nieuwe lijst
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.data?.list.name ?? 'Boodschappenlijst'}</h1>
          <p className="mt-1 text-slate-600">
            {open.length} nog te gaan
            {done.length > 0 ? ` · ${done.length} afgevinkt` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setBulkOpen((value) => !value)}>
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Bulk invoeren
          </Button>
          <Button
            onClick={async () => {
              const id = await createList('Nieuwe lijst');
              if (id) setListId(id);
            }}
            disabled={creating}
          >
            Nieuwe lijst
          </Button>
        </div>
      </header>

      {detail.error ? <Notice kind="error" title="Lijst laden mislukt">{detail.error}</Notice> : null}
      {detail.loading ? <Spinner label="Lijst laden" /> : null}

      {bulkOpen ? <BulkImport listId={listId} onDone={() => { setBulkOpen(false); detail.reload(); reloadLists(); }} /> : null}

      {items.length === 0 && !detail.loading ? (
        <Card>
          <EmptyState title="Deze lijst is leeg">
            <p>
              Gebruik <span className="font-medium">Bulk invoeren</span> en plak bijvoorbeeld
              <span className="mx-1 font-medium">2 melk, 1,5 l cola zero, 500 g pasta</span>.
            </p>
          </EmptyState>
        </Card>
      ) : null}

      {open.length > 0 ? (
        <Card>
          <CardTitle>Te kopen</CardTitle>
          <ItemList items={open} onChange={() => { detail.reload(); reloadLists(); }} />
        </Card>
      ) : null}

      {done.length > 0 ? (
        <Card>
          <CardTitle>In de winkelwagen ({done.length})</CardTitle>
          <ItemList items={done} onChange={() => { detail.reload(); reloadLists(); }} />
        </Card>
      ) : null}

      <OptimizationPanel
        loading={optLoading}
        error={optError}
        result={optimization}
        hasPricing={sources.hasLivePricing}
        onRetry={() => detail.reload()}
      />
    </div>
  );
}

function ItemList({ items, onChange }: { items: ItemDetail[]; onChange: () => void }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.id} className="py-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label={item.checked ? `${item.name} afvinken` : `${item.name} afvinken`}
              aria-pressed={item.checked}
              onClick={async () => {
                await api_.updateItem(item.id, { checked: !item.checked });
                onChange();
              }}
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                item.checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-transparent'
              }`}
            >
              <Check aria-hidden="true" className="h-4 w-4" />
            </button>

            <div className="min-w-0 flex-1">
              <p className={`font-medium ${item.checked ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                {item.name}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {item.amount} {item.unit}
                </span>
              </p>

              {item.best ? (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold text-emerald-700">{formatMoney(item.best.quote.basketCost)}</span>
                  <StoreChip name={item.best.storeName} small />
                  <span className="text-slate-600">{item.best.quote.label}</span>
                </p>
              ) : null}

              {item.quotes.length > 1 ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-sm text-brand-700">
                    {item.quotes.length} winkels vergelijken
                  </summary>
                  <ul className="mt-1.5 space-y-1 border-l border-slate-200 pl-3 text-sm">
                    {item.quotes.map((quote) => (
                      <li key={quote.storeId} className="flex flex-wrap items-center justify-between gap-2">
                        <StoreChip name={quote.storeName} small />
                        <span className="text-slate-700">
                          {formatMoney(quote.quote.basketCost)} · {formatMoney(quote.quote.unitPrice)} per eenheid
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {item.quotes.flatMap((quote) => quote.quote.warnings).length > 0 ? (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                  {listSentence([...new Set(item.quotes.flatMap((quote) => quote.quote.warnings))])}
                </p>
              ) : null}

              {item.quotes.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">Nog geen prijs bekend bij een gekoppelde bron.</p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={async () => {
                await api_.deleteItem(item.id);
                onChange();
              }}
              aria-label={`${item.name} verwijderen`}
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OptimizationPanel({
  loading,
  error,
  result,
  hasPricing,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  result: Awaited<ReturnType<typeof api_.optimize>> | null;
  hasPricing: boolean;
  onRetry: () => void;
}) {
  if (loading && !result) return <Card><Spinner label="Winkels vergelijken" /></Card>;
  if (error) return <Notice kind="error" title="Vergelijken mislukt">{error}</Notice>;
  if (!result) return null;

  if (result.totalPricedItems === 0) {
    return (
      <Card>
        <CardTitle>Waar kan ik het goedkoopst winkelen?</CardTitle>
        <EmptyState title="Nog geen prijzen om te vergelijken">
          <p>
            Zonder prijzen kan de app niet bepalen welke winkel het voordeligst is. Er worden geen bedragen
            getoond die niet uit een bron komen.
          </p>
          {!hasPricing ? (
            <p className="mt-2">
              Koppel een officiële databron, of vul prijzen zelf in via Instellingen.
            </p>
          ) : null}
          <p className="mt-2">
            <button type="button" onClick={onRetry} className="font-medium text-brand-700 underline">
              Opnieuw proberen
            </button>
          </p>
        </EmptyState>
      </Card>
    );
  }

  const plans: StorePlan[] = [
    result.cheapestSingleStore ? { ...result.cheapestSingleStore, title: 'Alles bij één winkel (goedkoopste)' } : null,
    { ...result.cheapestCombination, title: 'Goedkoopste combinatie' },
    { ...result.minimalStores, title: `Zo min mogelijk winkels (${result.minimalStores.storeIds.length})` },
  ].filter((plan): plan is StorePlan => plan !== null);

  return (
    <Card>
      <CardTitle
        action={
          result.savingsVsMostExpensive > 0 ? (
            <StatusPill status="ok" label={`Bespaart ${formatMoney(result.savingsVsMostExpensive)}`} />
          ) : null
        }
      >
        Waar kan ik het goedkoopst winkelen?
      </CardTitle>

      {!result.hasCompletePricing ? (
        <div className="mb-3">
          <Notice kind="warning" title="Het totaal is niet compleet">
            {result.unpriced.length} product(en) hebben geen prijs en tellen niet mee. Dat is beter dan een
            schatting: {listSentence(result.unpriced.map((entry) => entry.name))}.
          </Notice>
        </div>
      ) : null}

      <div className="space-y-3">
        {plans.map((plan) => (
          <div
            key={plan.title}
            className={`rounded-lg border p-3 ${
              plan.total === result.cheapestTotal && plan.isComplete
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-slate-200'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">{plan.title}</p>
              <p className="text-lg font-semibold text-slate-900">{formatMoney(plan.total)}</p>
            </div>
            <p className="mt-0.5 text-sm text-slate-600">{plan.description}</p>

            {plan.storeIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {plan.storeIds.map((storeId) => (
                  <StoreChip key={storeId} name={storeIdToName(storeId)} small />
                ))}
              </div>
            ) : null}

            {!plan.isComplete && plan.missingItems.length > 0 ? (
              <p className="mt-2 text-sm text-amber-800">
                Niet verkrijgbaar in dit plan: {listSentence(plan.missingItems)}.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

function storeIdToName(storeId: string): string {
  const names: Record<string, string> = {
    lidl: 'Lidl',
    albert_heijn: 'Albert Heijn',
    dirk: 'Dirk',
    kruidvat: 'Kruidvat',
  };
  return names[storeId] ?? storeId;
}

/** Bulk-invoer met preview: niets wordt opgeslagen vóór je bevestigt. */
function BulkImport({ listId, onDone }: { listId: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsePreviewItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const pantry = useLoadable(() => api_.pantry(), []);

  const included = useMemo(
    () => (preview ?? []).filter((_, index) => !excluded.has(index)),
    [preview, excluded],
  );

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = await api_.parse(text);
      setPreview(result.items);
      setMessage(result.message);
      setExcluded(new Set());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Analyse mislukt.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      await api_.importToList(
        listId,
        included.map((item) => ({
          name: item.name,
          amount: item.quantity.amount,
          unit: item.quantity.unit,
          productId: item.suggestedProductId,
          inPantry: item.inPantry,
        })),
      );
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Toevoegen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle
        action={
          <button type="button" onClick={onDone} aria-label="Sluiten" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        }
      >
        Bulk invoeren
      </CardTitle>

      <p className="mb-2 text-sm text-slate-600">
        Plak je lijstje. Commas, puntkomma&apos;s en regeleinden splitsen producten; een komma tussen twee
        cijfers is een komma in de hoeveelheid, dus <span className="font-medium">1,5 l</span> blijft 1,5 liter.
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        placeholder={'2 melk\n1,5 l cola zero\n3 x pakken yoghurt van 500 g\n500 g pasta'}
        className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm focus:border-brand-500"
        aria-label="Tekst met boodschappen"
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={runPreview} disabled={busy || text.trim().length === 0}>
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          Analyseer
        </Button>
        {preview ? (
          <Button variant="secondary" onClick={() => { setPreview(null); setMessage(null); setExcluded(new Set()); }}>
            Opnieuw
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3">
          <Notice kind="error" title="Dat lukte niet">
            {error}
          </Notice>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-sm text-slate-700">{message}</p> : null}

      {preview ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-slate-700">
            {included.length} van {preview.length} regel(s) worden toegevoegd. Haal een regel weg met het
            kruisje.
          </p>

          <ul className="divide-y divide-slate-100">
            {preview.map((item, index) => {
              const skipped = excluded.has(index);
              return (
                <li key={`${item.name}-${index}`} className={`py-2 ${skipped ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExcluded((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                      aria-label={skipped ? `${item.name} toevoegen` : `${item.name} overslaan`}
                      className="mt-0.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                    >
                      {skipped ? <ListPlus aria-hidden="true" className="h-4 w-4" /> : <X aria-hidden="true" className="h-4 w-4" />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {item.name}{' '}
                        <span className="font-normal text-slate-500">
                          {item.quantity.amount} {item.quantity.unit}
                        </span>
                      </p>

                      {item.needsConfirmation ? (
                        <p className="text-xs text-amber-800">
                          Even nakijken: dit is nog niet met zekerheid aan een product gekoppeld.
                          {item.candidates.length > 0 ? ` Mogelijk: ${listSentence(item.candidates.map((c) => c.name))}.` : ''}
                        </p>
                      ) : item.suggestedProductName ? (
                        <p className="text-xs text-slate-500">Gekoppeld aan {item.suggestedProductName}</p>
                      ) : null}

                      {item.inPantry ? (
                        <StatusPill
                          status="ok"
                          label={`In voorraad (${item.pantryAmount ?? '?'} ${item.quantity.unit})`}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {pantry.data && pantry.data.items.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              {pantry.data.items.length} product(en) staan in je voorraadkast; die hoef je niet opnieuw te kopen.
            </p>
          ) : null}

          <div className="mt-3">
            <Button onClick={commit} disabled={busy || included.length === 0} full>
              {included.length} product(en) toevoegen
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
