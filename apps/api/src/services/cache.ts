/**
 * In-memorycache met TTL.
 *
 * Doel: dezelfde aanbiedingen of prijzen niet steeds opnieuw ophalen. Elke
 * entry heeft een levensduur; daarna wordt de bron opnieuw geraadpleegd (of
 * de foutmelding opnieuw getoond). We slaan ook mislukkingen kort op, zodat een
 * storing bij een winkel niet bij elke paginaverversing opnieuw een time-out
 * veroorzaakt.
 */

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  expired: number;
}

export interface TtlCacheOptions {
  maxEntries?: number;
  /** Standaard levensduur in seconden. */
  defaultTtlSeconds?: number;
  /** Klokfunctie, injecteerbaar voor tests. */
  now?: () => number;
}

export class TtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expired = 0;

  constructor(options: TtlCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.defaultTtlMs = (options.defaultTtlSeconds ?? 3600) * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      this.expired += 1;
      this.misses += 1;
      return null;
    }
    // Markeer als recent zodat de LRU-vervanging werkt.
    this.store.delete(key);
    this.store.set(key, entry as CacheEntry<unknown>);
    this.hits += 1;
    return entry.value;
  }

  set<T>(key: string, value: T, ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTtlMs / 1000) * 1000;
    this.store.set(key, { value, storedAt: this.now(), expiresAt: this.now() + ttl });
    this.evictIfNeeded();
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Verwijdert alle entries die met `prefix` beginnen. */
  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /** Tijdstip waarop de entry is opgeslagen; null als die er niet is. */
  storedAt(key: string): number | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) return null;
    return entry.storedAt;
  }

  ageSeconds(key: string): number | null {
    const storedAt = this.storedAt(key);
    if (storedAt === null) return null;
    return Math.max(0, Math.round((this.now() - storedAt) / 1000));
  }

  get size(): number {
    return this.store.size;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.store.size,
      expired: this.expired,
    };
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) return;
      this.store.delete(oldest.value);
      this.evictions += 1;
    }
  }
}

/** Bouwt de cache op basis van de configuratie. */
export function createCache(options: TtlCacheOptions = {}): TtlCache {
  return new TtlCache(options);
}

/** Standaard sleutels, zodat alle onderdelen dezelfde entry delen. */
export const CacheKeys = {
  offers: (storeId: string) => `offers:${storeId}`,
  allOffers: () => 'offers:__all__',
  storeStatus: (storeId: string) => `status:${storeId}`,
  productMetadata: (gtin: string) => `product:${gtin}`,
  prices: (storeId: string) => `prices:${storeId}`,
} as const;
