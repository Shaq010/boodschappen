/**
 * App-root: gedeelde staat, router en de gedeelde brondata.
 *
 * De brondata en de actieve lijst staan in context, zodat elk scherm dezelfde
 * lijst en dezelfde bronstatus ziet en niet telkens opnieuw hoeft te laden.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell.js';
import { Button, Notice } from './components/ui.js';
import { api_, ApiError, type ListSummary } from './lib/api.js';
import { ActiveListContext, SourcesContext, type ActiveListValue, type SourcesValue } from './lib/hooks.js';
import { DashboardPage } from './pages/dashboard.js';
import { ShoppingListPage } from './pages/shopping-list.js';
import { MenuPage } from './pages/menu.js';
import { OffersPage } from './pages/offers.js';
import { PricesPage } from './pages/prices.js';
import { PantryPage } from './pages/pantry.js';
import { SettingsPage } from './pages/settings.js';

const LIST_STORAGE_KEY = 'boodschappen:actieve-lijst';

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

/**
 * Alles behalve de router. Zo kunnen tests een eigen router (met een vaste
 * beginpagina) omheen zetten.
 */
export function AppRoutes() {
  return (
    <Providers>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/lijst" element={<ShoppingListPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/aanbiedingen" element={<OffersPage />} />
          <Route path="/prijzen" element={<PricesPage />} />
          <Route path="/voorraad" element={<PantryPage />} />
          <Route path="/instellingen" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </Providers>
  );
}

function Providers({ children }: { children: React.ReactNode }) {
  const sources = useSourcesProvider();
  const activeList = useActiveListProvider();

  return (
    <SourcesContext.Provider value={sources}>
      <ActiveListContext.Provider value={activeList}>
        <StartupFailure sources={sources}>{children}</StartupFailure>
      </ActiveListContext.Provider>
    </SourcesContext.Provider>
  );
}

/** Bronstatus één keer laden en delen. */
function useSourcesProvider(): SourcesValue {
  const [sources, setSources] = useState<SourcesValue['sources']>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api_
      .sources()
      .then((result) => {
        if (!active) return;
        setSources(result.sources);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof ApiError
            ? cause.userMessage
            : 'Geen verbinding met de server. Start de API met `npm run dev -w @boodschappen/api`.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return useMemo(
    () => ({
      sources,
      loading,
      error,
      reload,
      hasLivePricing: sources.some((source) => source.status === 'connected'),
      configuredCount: sources.filter((source) => source.status === 'connected').length,
      totalStores: sources.length,
    }),
    [sources, loading, error, reload],
  );
}

/** De actieve lijst, onthouden in localStorage zodat een herstart je lijst teruggeeft. */
function useActiveListProvider(): ActiveListValue {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [listId, setListIdState] = useState<string | null>(readStoredListId);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);

  const reloadLists = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    api_
      .lists()
      .then((result) => {
        if (!active) return;
        setLists(result.lists);
        setListIdState((current) => {
          if (current && result.lists.some((list) => list.id === current)) return current;
          return result.lists[0]?.id ?? null;
        });
      })
      .catch(() => {
        // De schermen tonen zelf de foutmelding; hier is niets te herstellen.
        if (active) setLists([]);
      });
    return () => {
      active = false;
    };
  }, [tick]);

  const setListId = useCallback((id: string) => {
    setListIdState(id);
    try {
      window.localStorage.setItem(LIST_STORAGE_KEY, id);
    } catch {
      // Privémodus of uitgeschakelde opslag: niet fataal.
    }
  }, []);

  const createList = useCallback(async (name?: string): Promise<string | null> => {
    setCreating(true);
    try {
      const result = await api_.createList(name);
      setTick((value) => value + 1);
      setListId(result.list.id);
      return result.list.id;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) return null;
      return null;
    } finally {
      setCreating(false);
    }
  }, [setListId]);

  return useMemo(
    () => ({ listId, setListId, lists, reloadLists, creating, createList }),
    [listId, setListId, lists, reloadLists, creating, createList],
  );
}

/**
 * Foutafhandeling rond de app heen. Zonder server kan de app niets tonen, en
 * dan is één duidelijke uitleg beter dan zeven lege schermen.
 */
function StartupFailure({ children, sources }: { children: React.ReactNode; sources: SourcesValue }) {
  if (sources.error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <Notice kind="error" title="De app kan de server niet bereiken">
          <p>{sources.error}</p>
          <p className="mt-2">
            Start de API met <span className="font-mono text-xs">npm run dev -w @boodschappen/api</span> en
            probeer het opnieuw.
          </p>
        </Notice>
        <div className="mt-3">
          <Button onClick={sources.reload}>Opnieuw proberen</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function readStoredListId(): string | null {
  try {
    return window.localStorage.getItem(LIST_STORAGE_KEY);
  } catch {
    return null;
  }
}
