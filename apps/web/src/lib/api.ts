/**
 * API-client voor de frontend.
 *
 * Belangrijk: hier staat GEEN api-key en komt er ook geen api-key in. De
 * browser praat alleen met onze eigen API, en die spreekt namens ons met de
 * winkels. Wil je de API op een andere host draaien, zet dan VITE_API_URL.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** Vriendelijke uitleg voor de gebruiker. */
  get userMessage(): string {
    if (this.status === 0) return 'Geen verbinding met de app. Controleer of de server draait.';
    if (this.status >= 500) return 'De server heeft een probleem. Probeer het zo opnieuw.';
    return this.message;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'Geen verbinding met de app. Draait de server?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      (body as { message?: string; error?: string } | null)?.message ??
      (body as { error?: string } | null)?.error ??
      `Er ging iets mis (${response.status})`;
    throw new ApiError(response.status, message, body);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Typen uit de API
// ---------------------------------------------------------------------------

export type StoreId = 'lidl' | 'albert_heijn' | 'dirk' | 'kruidvat';

export interface PublicConfig {
  version: string;
  environment: string;
  networkEnabled: boolean;
  defaultCacheTtlSeconds: number;
  sources: Array<{ storeId: StoreId; provider: string; label: string; configured: boolean; documentationUrl: string | null }>;
  productMetadataEnabled: boolean;
}

export type SourceStatus =
  | 'connected'
  | 'not_configured'
  | 'network_disabled'
  | 'error'
  | 'rate_limited'
  | 'syncing';

export interface SourceInfo {
  storeId: StoreId;
  storeName: string;
  status: SourceStatus;
  message: string;
  offerCount: number;
  priceCount: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  ageSeconds: number | null;
  documentationUrl: string | null;
  requiredEnvVars: string[];
  requiredConfiguration: string[];
}

export interface SourcesResponse {
  sources: SourceInfo[];
  configuredCount: number;
  totalStores: number;
  hasLivePricing: boolean;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Start een sync en wacht op de afloop.
 *
 * Waarom dit op het web bestaat: de API start nu een sync op de achtergrond
 * (202). Een volledige run duurt ruim twee minuten — langer dan een HTTP-
 * verzoek kan blijven staan. Deze helper kijkt daarom na de start regelmatig
 * naar `GET /sources`, tot geen enkele betrokken winkel meer `syncing` is.
 * Geeft een korte samenvatting voor de gebruiker terug.
 */
export async function syncAndWait(storeId?: StoreId): Promise<string> {
  const started = await api_.sync(storeId);
  if (!started.started) return started.message;

  const deadline = Date.now() + 5 * 60_000;
  let last: SourcesResponse | null = null;

  for (;;) {
    await wait(2_500);
    last = await api_.sources();
    const relevant = storeId ? last.sources.filter((s) => s.storeId === storeId) : last.sources;
    if (!relevant.some((s) => s.status === 'syncing')) break;
    if (Date.now() > deadline) {
      return 'Bijwerken duurt langer dan verwacht. Kijk straks even bij de bronnen.';
    }
  }

  const relevant = last.sources.filter((s) => storeId ? s.storeId === storeId : true);
  if (storeId) {
    const store = relevant[0];
    if (!store) return 'Winkel niet gevonden.';
    if (store.status === 'connected') return `${store.storeName} is bijgewerkt.`;
    if (store.status === 'error' || store.status === 'rate_limited')
      return `Bijwerken van ${store.storeName} is mislukt.`;
    return `${store.storeName} heeft geen gekoppelde bron.`;
  }

  const connected = relevant.filter((s) => s.status === 'connected').length;
  if (connected === 0)
    return 'Er is geen enkele databron gekoppeld. Voer prijzen zelf in via Importeren.';
  return `${connected} van ${last.totalStores} winkels bijgewerkt.`;
}

export interface SyncStartResponse {
  started: boolean;
  stores: StoreId[];
  message: string;
}

export interface StoreInfo {
  id: StoreId;
  name: string;
  shortName: string;
  website: string | null;
  color: string;
  loyaltyCardName: string | null;
  order: number;
  configured: boolean;
}

export interface ListSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  checkedCount: number;
}

export interface ItemQuote {
  storeId: StoreId;
  storeName: string;
  quote: {
    unitPrice: number;
    savingsPerUnit: number;
    savingsPercent: number | null;
    basketCost: number;
    extraUnits: number;
    label: string;
    notices: string[];
    warnings: string[];
    requiresCard: boolean;
  };
}

export interface ItemDetail {
  id: string;
  listId: string;
  name: string;
  amount: number;
  unit: string;
  dimension: string;
  checked: boolean;
  inPantry: boolean;
  note: string | null;
  productId: string | null;
  quotes: ItemQuote[];
  best: ItemQuote | null;
  cheapestRegular: { storeId: StoreId; storeName: string; price: number } | null;
}

export interface ParsePreviewItem {
  name: string;
  normalizedName: string;
  quantity: { dimension: string; amount: number; unit: string };
  suggestedProductId: string | null;
  suggestedProductName: string | null;
  confidence: number | null;
  needsConfirmation: boolean;
  candidates: Array<{ productId: string; name: string; confidence: number }>;
  inPantry: boolean;
  pantryAmount: number | null;
}

export interface ParseResponse {
  items: ParsePreviewItem[];
  message: string;
  raw: { ignored: string[] };
}

export interface QuickAddResponse {
  added: number;
  items: ItemDetail[];
  /** Regels die niet automatisch gekoppeld konden worden, met voorstellen. */
  suggestions: Array<{ itemId: string; name: string; candidates: Array<{ productId: string; name: string; confidence: number }> }>;
  message: string;
}

export interface StorePlan {
  key: string;
  title: string;
  description: string;
  total: number;
  pricedItemCount: number;
  unpricedItemCount: number;
  isComplete: boolean;
  missingItems: string[];
  storeIds: string[];
  lines: Array<{
    storeId: string;
    itemCount: number;
    subtotal: number;
    items: Array<{ itemId: string; itemName: string; cost: number; quantity: string; label: string; warnings: string[] }>;
  }>;
}

export interface OptimizationResponse {
  perStore: StorePlan[];
  cheapestSingleStore: StorePlan | null;
  cheapestSingleStoreTotal: number;
  cheapestCombination: StorePlan;
  minimalStores: StorePlan;
  cheapestTotal: number;
  minimalStoresTotal: number;
  mostExpensiveTotal: number;
  savingsVsMostExpensive: number;
  unpriced: Array<{ itemId: string; name: string; reason: string }>;
  totalPricedItems: number;
  totalUnpricedItems: number;
  hasCompletePricing: boolean;
  message: string;
}

export interface OfferRow {
  id: string;
  storeId: StoreId;
  storeName: string;
  productId: string;
  title: string;
  description: string | null;
  kind: string;
  conditions: Record<string, unknown>;
  offerPriceCents: number | null;
  regularPriceCents: number | null;
  currency: string;
  validFrom: string | null;
  validUntil: string | null;
  packDescription: string | null;
  sourceName: string | null;
  sourceConfigured: boolean;
}

export interface PantryItem {
  id: string;
  name: string;
  normalizedName: string;
  dimension: string;
  amount: number;
  unit: string;
}

export interface NeededItem {
  name: string;
  amount: number;
  unit: string;
  dimension: string;
  inPantry: boolean;
  pantryAmount: number | null;
  toBuy: boolean;
}

export interface Meal {
  id: string;
  day: string;
  name: string;
  note: string | null;
  ingredients: NeededItem[];
}

export interface WeekMenu {
  id: string;
  weekStart: string;
  title: string | null;
  meals: Meal[];
  shopping: NeededItem[];
  combined: Array<{ name: string; fromDays: string[] }>;
  notices: string[];
}

export const api_ = {
  config: () => api.get<PublicConfig>('/config'),
  sources: () => api.get<SourcesResponse>('/sources'),
  sync: (storeId?: StoreId) => api.post<SyncStartResponse>('/sources/sync', storeId ? { storeId } : {}),
  stores: () => api.get<{ stores: StoreInfo[] }>('/stores'),
  offers: (storeId?: StoreId) => api.get<{ offers: OfferRow[]; count: number; hasLivePricing: boolean }>(`/offers${storeId ? `?storeId=${storeId}` : ''}`),
  lists: () => api.get<{ lists: ListSummary[] }>('/lists'),
  createList: (name?: string) => api.post<{ list: ListSummary }>('/lists', { name }),
  list: (id: string) => api.get<{ list: ListSummary; items: ItemDetail[] }>(`/lists/${id}`),
  addItem: (listId: string, body: { name: string; amount?: number; unit?: string; inPantry?: boolean }) =>
    api.post<{ item: ItemDetail }>(`/lists/${listId}/items`, body),
  updateItem: (id: string, body: Partial<{ name: string; amount: number; unit: string; checked: boolean; inPantry: boolean; note: string | null; productId: string | null }>) =>
    api.patch<{ item: ItemDetail }>(`/items/${id}`, body),
  deleteItem: (id: string) => api.delete<void>(`/items/${id}`),
  parse: (text: string) => api.post<ParseResponse>('/parse', { text }),
  /** Losse tekst meteen in de lijst zetten, zonder preview of bevestiging. */
  quickAdd: (listId: string, text: string) =>
    api.post<QuickAddResponse>(`/lists/${listId}/quick-add`, { text }),
  importToList: (listId: string, items: Array<{ name: string; amount?: number; unit?: string; productId?: string | null; inPantry?: boolean }>) =>
    api.post<{ added: number }>(`/lists/${listId}/import`, { items }),
  optimize: (listId: string, stores?: StoreId[]) =>
    api.get<OptimizationResponse>(`/lists/${listId}/optimize${stores?.length ? `?stores=${stores.join(',')}` : ''}`),
  pantry: () => api.get<{ items: PantryItem[] }>('/pantry'),
  addPantry: (body: { name: string; amount?: number; unit?: string }) => api.post<{ item: PantryItem }>('/pantry', body),
  removePantry: (id: string) => api.delete<void>(`/pantry/${id}`),
  menu: (date?: string) => api.get<{ menu: WeekMenu }>(`/menu${date ? `?date=${date}` : ''}`),
  addMeal: (body: { day: string; name: string; note?: string | null; ingredients?: Array<{ name: string; amount?: number; unit?: string; inPantry?: boolean }> }) =>
    api.post<{ menu: WeekMenu }>('/menu/meals', body),
  deleteMeal: (id: string) => api.delete<void>(`/menu/meals/${id}`),
  today: () => api.get<{ day: string; needed: NeededItem[] }>('/today'),
  products: () => api.get<{ products: Array<{ id: string; name: string; category: string; verified: boolean; source: string }>; unverified: number }>('/products'),
  confirmProduct: (id: string) => api.post<{ product: { id: string; verified: boolean } }>(`/products/${id}/confirm`),
  addAlias: (id: string, alias: string) => api.post<{ ok: boolean }>(`/products/${id}/alias`, { alias }),
};
