/**
 * Prijsvergelijking.
 *
 * Twee dingen tegelijk: welke winkels welke producten het goedkoopst hebben,
 * en welke winkelsamenstelling voor de huidige lijst het beste uitpakt.
 * Beide staan bewijsloos zolang er geen prijzen zijn — de app rekent niets
 * wat niet uit een bron komt.
 */

import { useState } from 'react';
import { Scale } from 'lucide-react';
import { api_, ApiError, type OptimizationResponse, type StoreId } from '../lib/api.js';
import { useActiveList, useLoadable, useSources } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StatRow, StatusPill, StoreChip } from '../components/ui.js';
import { formatMoney, listSentence } from '../lib/format.js';

const ALL_STORES: StoreId[] = ['lidl', 'albert_heijn', 'dirk', 'kruidvat'];
const STORE_NAMES: Record<StoreId, string> = {
  lidl: 'Lidl',
  albert_heijn: 'Albert Heijn',
  dirk: 'Dirk',
  kruidvat: 'Kruidvat',
};

export function PricesPage() {
  usePageTitle('Prijsvergelijking');
  const sources = useSources();
  const { listId } = useActiveList();
  const [selected, setSelected] = useState<StoreId[]>([...ALL_STORES]);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detail = useLoadable(() => (listId ? api_.list(listId) : Promise.resolve(null)), [listId]);
  const items = detail.data?.items ?? [];

  function toggle(storeId: StoreId) {
    setSelected((current) =>
      current.includes(storeId) ? current.filter((value) => value !== storeId) : [...current, storeId],
    );
  }

  async function compare() {
    if (!listId) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api_.optimize(listId, selected));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'Vergelijken mislukt.');
    } finally {
      setBusy(false);
    }
  }

  const priceMatrix = items.map((item) => ({
    item,
    quotes: ALL_STORES.map((storeId) => ({
      storeId,
      quote: item.quotes.find((entry) => entry.storeId === storeId)?.quote ?? null,
    })),
  }));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Prijsvergelijking</h1>
        <p className="mt-1 text-slate-600">
          Vergelijk de vier winkels per product en zie welke combinatie het gunstigst is.
        </p>
      </header>

      {!sources.hasLivePricing && !sources.loading ? (
        <Notice kind="warning" title="Nog geen prijzen beschikbaar">
          <p>
            Lidl, Albert Heijn, Dirk en Kruidvat hebben geen openbare API voor prijzen en verbieden
            geautomatiseerd ophalen. Zonder officiële koppeling blijft deze pagina leeg.
          </p>
          <p className="mt-2">
            Wat je wél kunt doen: een geautoriseerde bron instellen, of je eigen prijzen invoeren in
            Instellingen. Er worden nooit schattingen getoond.
          </p>
        </Notice>
      ) : null}

      <Card>
        <CardTitle>Winkels vergelijken</CardTitle>
        <fieldset>
          <legend className="mb-2 text-sm text-slate-600">Kies welke winkels meedoen</legend>
          <div className="flex flex-wrap gap-2">
            {ALL_STORES.map((storeId) => (
              <label
                key={storeId}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  selected.includes(storeId) ? 'border-brand-400 bg-brand-50 text-brand-900' : 'border-slate-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(storeId)}
                  onChange={() => toggle(storeId)}
                  className="h-4 w-4"
                />
                {STORE_NAMES[storeId]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-3">
          <Button onClick={compare} disabled={busy || !listId || selected.length === 0}>
            <Scale aria-hidden="true" className="h-4 w-4" />
            {busy ? 'Berekenen' : 'Bereken beste winkelmix'}
          </Button>
          {!listId ? <p className="mt-2 text-sm text-slate-600">Maak eerst een boodschappenlijst aan.</p> : null}
        </div>
      </Card>

      {error ? <Notice kind="error" title="Vergelijken mislukt">{error}</Notice> : null}

      {result ? <CombinationResult result={result} /> : null}

      <Card>
        <CardTitle>Prijzen per product</CardTitle>
        {detail.loading ? <Spinner label="Lijst laden" /> : null}
        {!detail.loading && items.length === 0 ? (
          <EmptyState title="Nog niets om te vergelijken">
            <p>Zodra je producten op je lijst hebt en er prijzen beschikbaar zijn, verschijnt hier de vergelijking.</p>
          </EmptyState>
        ) : null}

        {items.length > 0 ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <caption className="sr-only">Beste prijs per product per winkel</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th scope="col" className="py-2 pr-3 font-semibold text-slate-700">Product</th>
                  {ALL_STORES.map((storeId) => (
                    <th key={storeId} scope="col" className="py-2 pr-3 font-semibold text-slate-700">
                      {STORE_NAMES[storeId]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {priceMatrix.map(({ item, quotes }) => {
                  const best = quotes.reduce<number | null>((lowest, entry) => {
                    if (!entry.quote) return lowest;
                    return lowest === null || entry.quote.basketCost < lowest ? entry.quote.basketCost : lowest;
                  }, null);

                  return (
                    <tr key={item.id} className="border-b border-slate-100 align-top">
                      <th scope="row" className="py-2.5 pr-3 text-left font-medium text-slate-900">
                        {item.name}
                        <span className="block text-xs font-normal text-slate-500">
                          {item.amount} {item.unit}
                        </span>
                      </th>
                      {quotes.map(({ storeId, quote }) => (
                        <td key={storeId} className="py-2.5 pr-3">
                          {quote ? (
                            <>
                              <span className="block font-semibold text-slate-900">
                                {formatMoney(quote.basketCost)}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {formatMoney(quote.unitPrice)} per {item.unit}
                              </span>
                              {best !== null && quote.basketCost === best ? (
                                <StatusPill status="ok" label="goedkoopst" />
                              ) : null}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">
              Betreft de winkelprijs voor jouw hoeveelheid. Ontbrekende prijzen blijven leeg in plaats van
              geschat.
            </p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function CombinationResult({ result }: { result: OptimizationResponse }) {
  if (result.totalPricedItems === 0) {
    return (
      <Card>
        <CardTitle>Uitkomst</CardTitle>
        <EmptyState title="Geen prijzen om mee te rekenen">
          <p>{result.message}</p>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle
        action={
          result.savingsVsMostExpensive > 0 ? (
            <StatusPill status="ok" label={`Tot ${formatMoney(result.savingsVsMostExpensive)} voordeliger`} />
          ) : null
        }
      >
        Beste winkelmix
      </CardTitle>

      <StatRow
        items={[
          { label: 'Goedkoopste totaal', value: formatMoney(result.cheapestTotal) },
          { label: 'Alles bij één winkel', value: formatMoney(result.cheapestSingleStoreTotal) },
          { label: 'Minst winkels', value: `${result.minimalStores.storeIds.length}` },
          { label: 'Zonder prijs', value: String(result.totalUnpricedItems) },
        ]}
      />

      {result.unpriced.length > 0 ? (
        <div className="mt-3">
          <Notice kind="warning" title="Deze producten tellen niet mee">
            {listSentence(result.unpriced.map((entry) => entry.name))}
            <span className="mt-1 block text-sm">{listSentence([...new Set(result.unpriced.map((e) => e.reason))])}</span>
          </Notice>
        </div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {[result.cheapestCombination, result.minimalStores, result.cheapestSingleStore]
          .filter((plan): plan is NonNullable<typeof plan> => plan !== null)
          .map((plan) => (
            <li key={plan.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{plan.title}</p>
                <p className="font-semibold text-slate-900">{formatMoney(plan.total)}</p>
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{plan.description}</p>
              {plan.storeIds.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {plan.storeIds.map((storeId) => (
                    <StoreChip key={storeId} name={STORE_NAMES[storeId as StoreId] ?? storeId} small />
                  ))}
                </div>
              ) : null}
              {!plan.isComplete && plan.missingItems.length > 0 ? (
                <p className="mt-2 text-sm text-amber-800">
                  Ontbreekt hier: {listSentence(plan.missingItems)}.
                </p>
              ) : null}

              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-brand-700">Per winkel bekijken</summary>
                <div className="mt-1.5 space-y-2">
                  {plan.lines.map((line) => (
                    <div key={line.storeId} className="rounded-md bg-slate-50 p-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <StoreChip name={STORE_NAMES[line.storeId as StoreId] ?? line.storeId} small />
                        <span className="font-medium text-slate-800">
                          {line.itemCount} product(en) · {formatMoney(line.subtotal)}
                        </span>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                        {line.items.map((entry) => (
                          <li key={entry.itemId} className="flex justify-between gap-2">
                            <span>
                              {entry.itemName} <span className="text-slate-400">({entry.quantity})</span>
                            </span>
                            <span>{formatMoney(entry.cost)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            </li>
          ))}
      </ul>

      <p className="mt-3 text-xs text-slate-500">{result.message}</p>
    </Card>
  );
}
