/**
 * Boodschappenlijst: de kern van de app.
 *
 * Zo simpel mogelijk: één veld waarin je typt wat je nodig hebt — "melk",
 * of in één keer "melk, cola, blikjes" — en Enter. De app zet het er meteen
 * bij. Er is geen analyseerscherm en geen bevestigingsdialoog; wat de app
 * zeker weet koppelt het aan een product, en de rest komt als gewone regel in
 * de lijst. Een eventuele koppeling bieden we achteraf aan, zonder te blokkeren.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, ListPlus, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import { api_, ApiError, type ItemDetail, type StorePlan } from '../lib/api.js';
import { useActiveList, useLoadable, useSources } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StoreChip, StatusPill } from '../components/ui.js';
import { formatMoney, listSentence } from '../lib/format.js';

export function ShoppingListPage() {
  usePageTitle('Boodschappenlijst');
  const { listId, lists, createList, creating, setListId, reloadLists } = useActiveList();
  const sources = useSources();

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
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{detail.data?.list.name ?? 'Boodschappen'}</h1>
        <p className="mt-1 text-slate-600">
          {open.length} nog te gaan
          {done.length > 0 ? ` · ${done.length} afgevinkt` : ''}
        </p>
      </header>

      {detail.error ? <Notice kind="error" title="Lijst laden mislukt">{detail.error}</Notice> : null}
      {detail.loading ? <Spinner label="Lijst laden" /> : null}

      <QuickAdd
        listId={listId}
        onAdded={() => {
          detail.reload();
          reloadLists();
        }}
      />

      <ListTools
        onNewList={async () => {
          const id = await createList('Nieuwe lijst');
          if (id) setListId(id);
        }}
        creating={creating}
        lists={lists}
        onPick={setListId}
        onReload={() => {
          reloadLists();
          detail.reload();
        }}
      />

      {items.length === 0 && !detail.loading ? (
        <Card>
          <EmptyState title="Deze lijst is leeg">
            <p>
              Typ hierboven wat je nodig hebt, bijvoorbeeld{' '}
              <span className="font-medium">melk, cola, blikjes</span>.
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
function QuickAdd({ listId, onAdded }: { listId: string; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Koppelvoorstellen die je één keer kunt aannemen; na toevoegen gezet.
  const [offers, setOffers] = useState<
    Array<{ itemId: string; name: string; candidates: Array<{ productId: string; name: string }> }>
  >([]);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api_.quickAdd(listId, value);
      setText('');
      setMessage(result.message);
      setOffers(result.suggestions);
      onAdded();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Toevoegen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  async function link(itemId: string, productId: string) {
    try {
      await api_.updateItem(itemId, { productId });
      setOffers((current) => current.filter((offer) => offer.itemId !== itemId));
      onAdded();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Koppelen mislukt.');
    }
  }

  return (
    <Card>
      <label htmlFor="snel-toevoegen" className="block text-sm font-medium text-slate-700">
        Wat heb je nodig?
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="snel-toevoegen"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="melk, cola, blikjes"
          autoComplete="off"
          enterKeyHint="done"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none"
        />
        <Button onClick={() => void submit()} disabled={busy || !text.trim()}>
          <ListPlus aria-hidden="true" className="h-4 w-4" />
          Toevoegen
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        Typ één product of meerdere met komma&apos;s. Enter voegt ze meteen toe.
      </p>

      {error ? (
        <div className="mt-3">
          <Notice kind="error" title="Dat lukte niet">
            {error}
          </Notice>
        </div>
      ) : null}
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}

      {offers.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {offers.map((offer) => (
            <li key={offer.itemId} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-medium">{offer.name}</span> is toegevoegd. Wil je het koppelen aan{'\u00a0'}
              {offer.candidates[0]?.name}?
              <button
                type="button"
                onClick={() => void link(offer.itemId, offer.candidates[0]!.productId)}
                className="ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-white"
              >
                <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
                Ja, koppelen
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** Lijst kiezen of een nieuwe aanmaken; staat bewust onder het invulveld. */
function ListTools({
  onNewList,
  creating,
  lists,
  onPick,
  onReload,
}: {
  onNewList: () => Promise<void>;
  creating: boolean;
  lists: Array<{ id: string; name: string; itemCount: number }>;
  onPick: (id: string) => void;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lists.length > 1 ? (
        <select
          aria-label="Kies je lijst"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) onPick(event.target.value);
          }}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700"
        >
          <option value="">Andere lijst…</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name} ({list.itemCount})
            </option>
          ))}
        </select>
      ) : null}
      <Button variant="secondary" size="sm" onClick={() => void onNewList()} disabled={creating}>
        <ListPlus aria-hidden="true" className="h-4 w-4" />
        Nieuwe lijst
      </Button>
      <Button variant="secondary" size="sm" onClick={onReload}>
        Vernieuwen
      </Button>
    </div>
  );
}

