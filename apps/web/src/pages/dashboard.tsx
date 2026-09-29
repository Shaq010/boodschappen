/**
 * Dashboard: het overzicht.
 *
 * Zegt in één oogopslag: hoeveel producten er op je lijst staan, wat je vandaag
 * nodig hebt, of er live prijzen zijn, en — als dat er niet zijn — wat je
 * kunt doen om ze wél te krijgen. Er staat nooit een bedrag dat niet uit een
 * bron komt.
 */

import { Link } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api_, ApiError, syncAndWait } from '../lib/api.js';
import { useActiveList, useLoadable, useSources } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, EmptyState, Notice, Spinner, StatRow, StatusPill } from '../components/ui.js';
import { formatAge, formatMoney, greeting, sourceStatusLabel } from '../lib/format.js';

export function DashboardPage() {
  usePageTitle('Dashboard');
  const sources = useSources();
  const { listId, lists } = useActiveList();
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const list = useLoadable(
    () => (listId ? api_.list(listId) : Promise.resolve(null)),
    [listId],
  );
  const today = useLoadable(() => api_.today(), []);

  const items = list.data?.items ?? [];
  const open = items.filter((item) => !item.checked);
  const priced = items.filter((item) => item.quotes.length > 0);
  const withWarnings = priced.filter((item) => item.quotes.some((quote) => quote.quote.warnings.length > 0));
  const toBuyToday = (today.data?.needed ?? []).filter((item) => item.toBuy);

  async function sync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const message = await syncAndWait();
      setSyncMessage(message);
      sources.reload();
    } catch (error) {
      setSyncMessage(error instanceof ApiError ? error.userMessage : 'Ophalen mislukt.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{greeting()}</h1>
        <p className="mt-1 text-slate-600">
          {list.data ? (
            <>
              <span className="font-medium">{list.data.list.name}</span> — {open.length} van {items.length} producten nog te gaan.
            </>
          ) : (
            'Maak een boodschappenlijst aan om te beginnen.'
          )}
        </p>
      </header>

      <Card>
        <StatRow
          items={[
            { label: 'Openstaand', value: String(open.length) },
            { label: 'Met prijs', value: `${priced.length}/${items.length}` },
            { label: 'Aanbiedingen', value: String(sources.sources.reduce((sum, s) => sum + s.offerCount, 0)) },
            { label: 'Gekoppelde winkels', value: `${sources.configuredCount}/${sources.totalStores}` },
          ]}
        />
      </Card>

      {/* Bronstatus: eerlijk zeggen waarom er wel of geen prijzen zijn. */}
      <Card>
        <CardTitle
          action={
            <Button size="sm" variant="secondary" onClick={sync} disabled={syncing}>
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Bezig' : 'Vernieuwen'}
            </Button>
          }
        >
          Databronnen
        </CardTitle>

        {syncMessage ? (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{syncMessage}</p>
        ) : null}

        <ul className="divide-y divide-slate-100">
          {sources.sources.map((source) => (
            <li key={source.storeId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{source.storeName}</p>
                <p className="text-sm text-slate-600">
                  {source.status === 'connected'
                    ? `${source.offerCount} aanbiedingen · bijgewerkt ${formatAge(source.ageSeconds)}`
                    : source.status === 'not_configured'
                      ? 'Geen officiële bron gekoppeld — daarom geen prijzen.'
                      : source.status === 'network_disabled'
                        ? 'Het netwerk staat uit, dus er worden geen prijzen opgehaald.'
                        : source.lastError ?? source.message}
                </p>
              </div>
              <StatusPill
                status={
                  source.status === 'connected'
                    ? 'ok'
                    : source.status === 'error' || source.status === 'rate_limited'
                      ? 'error'
                      : 'info'
                }
                label={sourceStatusLabel(source.status)}
              />
            </li>
          ))}
        </ul>

        {sources.sources.every((source) => source.status === 'not_configured') ? (
          <div className="mt-3">
            <Notice kind="info" title="Er is nog geen databron gekoppeld">
              <p>
                Lidl, Albert Heijn, Dirk en Kruidvat publiceren geen openbare API voor prijzen, en hun websites
                verbieden geautomatiseerd ophalen. Deze app verzint daarom geen prijzen. Je kunt een officiële,
                geautoriseerde koppeling instellen, of je eigen prijzen invoeren via de instellingen.
              </p>
              <p className="mt-2">
                <Link to="/instellingen" className="font-medium underline">
                  Naar de instellingen
                </Link>
              </p>
            </Notice>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardTitle
            action={
              <Link to="/lijst" className="text-sm font-medium text-brand-700 hover:underline">
                Open lijst
              </Link>
            }
          >
            Vandaag nodig
          </CardTitle>

          {today.loading ? <Spinner label="Menu laden" /> : null}
          {today.error ? <Notice kind="error" title="Menu kon niet geladen worden">{today.error}</Notice> : null}

          {!today.loading && (today.data?.needed.length ?? 0) === 0 ? (
            <EmptyState title="Vandaag staat er geen gerecht gepland">
              <Link to="/menu" className="font-medium text-brand-700 underline">
                Zet iets in het weekmenu
              </Link>
            </EmptyState>
          ) : null}

          {toBuyToday.length > 0 ? (
            <ul className="space-y-1.5">
              {toBuyToday.map((item) => (
                <li key={item.name} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-800">{item.name}</span>
                  <span className="text-slate-500">
                    {item.amount} {item.unit}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardTitle>Aandachtspunten</CardTitle>
          {withWarnings.length > 0 ? (
            <>
              <p className="mb-2 text-sm text-slate-600">
                {withWarnings.length} product(en) hebben voorwaarden bij de goedkoopste prijs:
              </p>
              <ul className="space-y-2">
                {withWarnings.slice(0, 4).map((item) => (
                  <li key={item.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <span className="font-medium">{item.name}</span>
                    <span className="block">
                      {item.best?.quote.label} — {item.quotes.flatMap((q) => q.quote.warnings).join(' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : items.length === 0 ? (
            <EmptyState title="Je lijst is nog leeg">
              <p>
                Voeg producten toe, één voor één of in bulk. De app leest ook losse tekst zoals
                <span className="mx-1 font-medium">2 melk, 1,5 l cola</span>in.
              </p>
              <p className="mt-2">
                <Link to="/lijst" className="font-medium text-brand-700 underline">
                  Naar de lijst
                </Link>
              </p>
            </EmptyState>
          ) : (
            <p className="text-sm text-slate-600">Niks te melden — alles is helder.</p>
          )}
        </Card>
      </div>

      {lists.length === 0 && !list.loading ? (
        <Notice kind="info" title="Nog geen lijst">
          <p>Er staan nog geen lijsten in deze app. Maak er een aan via de lijstpagina.</p>
        </Notice>
      ) : null}
    </div>
  );
}
