/**
 * Kleine haken voor het ophalen van gegevens.
 *
 * Ze houden de laadstatus, de foutmelding en de herlaadknop op één plek, zodat
 * elk scherm hetzelfde gedrag heeft. Fouten worden nooit stilzwijgend genegeerd:
 * je ziet altijd wat er mis is en kunt opnieuw proberen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.js';

export interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Handmatig opnieuw proberen. */
  reload: () => void;
  /** Iets aan de lokale staat aanpassen zonder opnieuw te laden. */
  set: (updater: (current: T) => T) => void;
}

export function useLoadable<T>(loader: () => Promise<T>, deps: readonly unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    loaderRef
      .current()
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof ApiError ? cause.userMessage : 'Er ging iets mis bij het ophalen van gegevens.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const update = useCallback((updater: (current: T) => T) => {
    setData((current) => (current === null ? current : updater(current)));
  }, []);

  return { data, loading, error, reload, set: update };
}

/**
 * Status van de winkeldatabronnen. Wordt op veel plekken getoond, dus hij
 * wordt één keer geladen en gedeeld via context.
 */
export interface SourcesValue {
  sources: import('./api.js').SourceInfo[];
  hasLivePricing: boolean;
  configuredCount: number;
  totalStores: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

import { createContext, useContext } from 'react';
import type { SourceInfo } from './api.js';

export const SourcesContext = createContext<SourcesValue>({
  sources: [],
  hasLivePricing: false,
  configuredCount: 0,
  totalStores: 4,
  loading: true,
  error: null,
  reload: () => {},
});

export function useSources(): SourcesValue {
  return useContext(SourcesContext);
}

/** De actieve boodschappenlijst; één gedeelde keuze voor de hele app. */
export interface ActiveListValue {
  listId: string | null;
  setListId: (id: string) => void;
  lists: import('./api.js').ListSummary[];
  reloadLists: () => void;
  creating: boolean;
  createList: (name?: string) => Promise<string | null>;
}

export const ActiveListContext = createContext<ActiveListValue>({
  listId: null,
  setListId: () => {},
  lists: [],
  reloadLists: () => {},
  creating: false,
  createList: async () => null,
});

export function useActiveList(): ActiveListValue {
  return useContext(ActiveListContext);
}
