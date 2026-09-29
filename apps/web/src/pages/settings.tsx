/**
 * Instellingen: bronnen, winkels en productkoppelingen.
 *
 * Belangrijk principe, hier het duidelijkst zichtbaar: de app laat nooit zien
 * dat er een api-key is. De server beheert die; deze pagina laat alleen zien
 * welke winkels gekoppeld zijn en welke omgevingsvariabelen de beheerder moet
 * vullen.
 */

import { useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { api_, ApiError, syncAndWait } from '../lib/api.js';
import { useLoadable, useSources } from '../lib/hooks.js';
import { usePageTitle } from '../components/shell.js';
import { Button, Card, CardTitle, Notice, Spinner, StatusPill, StoreChip } from '../components/ui.js';
import { formatDateTime, listSentence, sourceStatusLabel } from '../lib/format.js';

export function SettingsPage() {
  usePageTitle('Instellingen');
  const sources = useSources();
  const config = useLoadable(() => api_.config(), []);
  const stores = useLoadable(() => api_.stores(), []);
  const products = useLoadable(() => api_.products(), []);
  const [aliasFor, setAliasFor] = useState<{ id: string; name: string } | null>(null);
  const [alias, setAlias] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [aliasDone, setAliasDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function saveAlias() {
    if (!aliasFor || alias.trim().length === 0) return;
    setBusy(true);
    setAliasError(null);
    setAliasDone(false);
    try {
      await api_.addAlias(aliasFor.id, alias.trim());
      setAlias('');
      setAliasFor(null);
      setAliasDone(true);
      products.reload();
    } catch (cause) {
      setAliasError(cause instanceof ApiError ? cause.userMessage : 'Toevoegen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Instellingen</h1>
        <p className="mt-1 text-slate-600">Bronnen, winkels en productherkenning.</p>
      </header>

      {config.data ? (
        <Card>
          <CardTitle>Over deze installatie</CardTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Versie</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{config.data.version}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Omgeving</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{config.data.environment}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Netwerk</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {config.data.networkEnabled ? 'Aan' : 'Uit (offline)'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Cachetijd</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{config.data.defaultCacheTtlSeconds} s</dd>
            </div>
          </dl>
        </Card>
      ) : null}

      <Card>
        <CardTitle
          action={
            <Button size="sm" variant="secondary" onClick={() => { sources.reload(); config.reload(); }}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Vernieuwen
            </Button>
          }
        >
          Databronnen per winkel
        </CardTitle>

        {syncMessage ? (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{syncMessage}</p>
        ) : null}

        <ul className="space-y-3">
          {sources.sources.map((source) => (
            <li key={source.storeId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StoreChip name={source.storeName} />
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
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Aanbiedingen</dt>
                  <dd className="font-medium text-slate-900">{source.offerCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Prijsregels</dt>
                  <dd className="font-medium text-slate-900">{source.priceCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Laatst gelukt</dt>
                  <dd className="font-medium text-slate-900">{formatDateTime(source.lastSuccessAt)}</dd>
                </div>
              </dl>

              {source.status === 'not_configured' ? (
                <div className="mt-2.5 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p>{source.message}</p>
                  {source.requiredEnvVars.length > 0 ? (
                    <p className="mt-1.5">
                      De beheerder moet deze variabelen instellen in de serveromgeving:{' '}
                      <span className="font-mono text-xs">{listSentence(source.requiredEnvVars)}</span>
                    </p>
                  ) : null}
                  {source.requiredConfiguration.length > 0 ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Voorwaarden: {listSentence(source.requiredConfiguration)}.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {source.status === 'network_disabled' ? (
                <div className="mt-2.5 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <p>{source.message}</p>
                  <p className="mt-1.5">
                    Dit is geen fout. Zet <span className="font-mono text-xs">ALLOW_NETWORK=true</span>{' '}
                    in de serveromgeving als je de prijzen op wilt halen.
                  </p>
                </div>
              ) : null}

              {source.lastError ? (
                <p className="mt-2.5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  Laatste fout: {source.lastError}
                </p>
              ) : null}

              <div className="mt-2.5">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const message = await syncAndWait(source.storeId);
                      setSyncMessage(message);
                      sources.reload();
                    } catch (cause) {
                      setSyncMessage(cause instanceof ApiError ? cause.userMessage : 'Synchroniseren mislukt.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy || source.status === 'not_configured'}
                >
                  Nu ophalen
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Productherkenning</CardTitle>
        <p className="mb-3 text-sm text-slate-600">
          De app koppelt je lijst aan producten op GTIN, en anders op naam. Producten die daar niet zeker van
          zijn, staan hieronder. Bevestig ze, of voeg een extra naam toe zodat de volgende keer het goed gaat.
        </p>

        {products.loading ? <Spinner label="Producten laden" /> : null}
        {products.error ? <Notice kind="error" title="Producten laden mislukt">{products.error}</Notice> : null}

        {aliasDone ? (
          <div className="mb-3">
            <Notice kind="success" title="Naam toegevoegd">
              Bij de volste import wordt dit product herkend.
            </Notice>
          </div>
        ) : null}

        {aliasError ? (
          <div className="mb-3">
            <Notice kind="error" title="Toevoegen mislukt">
              {aliasError}
            </Notice>
          </div>
        ) : null}

        {products.data && products.data.products.length === 0 && !products.loading ? (
          <Notice kind="info" title="Nog geen producten">
            <p>Zodra je iets op je lijst zet, verschijnen hier de herkende producten.</p>
          </Notice>
        ) : null}

        {products.data ? (
          <ul className="divide-y divide-slate-100">
            {products.data.products.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{product.name}</p>
                  <p className="text-sm text-slate-600">
                    {product.category} · bron: {product.source}
                  </p>
                </div>

                {product.verified ? (
                  <StatusPill status="ok" label="Bevestigd" />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        await api_.confirmProduct(product.id);
                        products.reload();
                      }}
                      disabled={busy}
                    >
                      <Check aria-hidden="true" className="h-4 w-4" />
                      Bevestigen
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAliasFor({ id: product.id, name: product.name });
                        setAlias('');
                        setAliasDone(false);
                      }}
                    >
                      Naam toevoegen
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {aliasFor ? (
          <div className="mt-3 rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-800">Extra naam voor {aliasFor.name}</p>
            <div className="flex flex-wrap gap-2">
              <input
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder="bijvoorbeeld: die halfvolle melk van AH"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2.5"
                aria-label="Extra naam"
              />
              <Button onClick={saveAlias} disabled={busy || alias.trim().length === 0}>
                Opslaan
              </Button>
              <Button variant="ghost" onClick={() => setAliasFor(null)}>
                Annuleren
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Winkels</CardTitle>
        {stores.loading ? <Spinner label="Winkels laden" /> : null}
        {stores.data ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {stores.data.stores.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="font-medium text-slate-900">{store.name}</p>
                  <p className="text-sm text-slate-600">
                    {store.loyaltyCardName ? `Loyaltykaart: ${store.loyaltyCardName}` : 'Geen loyaltykaart'}
                  </p>
                </div>
                <StatusPill
                  status={store.configured ? 'ok' : 'info'}
                  label={store.configured ? 'Gekoppeld' : 'Niet gekoppeld'}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
