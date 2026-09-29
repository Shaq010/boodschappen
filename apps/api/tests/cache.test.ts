import { describe, expect, it } from 'vitest';
import { TtlCache, createCache, CacheKeys } from '../src/services/cache.js';

describe('TtlCache', () => {
  it('bewaart en leest waarden', () => {
    const cache = new TtlCache();
    cache.set('a', { value: 1 });
    expect(cache.get<{ value: number }>('a')).toEqual({ value: 1 });
  });

  it('geeft null terug voor onbekende sleutels en telt een miss', () => {
    const cache = new TtlCache();
    expect(cache.get('bestaat-niet')).toBeNull();
    expect(cache.stats().misses).toBe(1);
  });

  it('verloopt entries na de ttl', () => {
    let now = 1_000_000;
    const cache = new TtlCache({ now: () => now });
    cache.set('a', 'waarde', 60);
    expect(cache.get('a')).toBe('waarde');
    now += 59_000;
    expect(cache.get('a')).toBe('waarde');
    now += 2_000;
    expect(cache.get('a')).toBeNull();
    expect(cache.size).toBe(0);
    expect(cache.stats().expired).toBe(1);
  });

  it('gebruikt de standaard-ttl als er geen ttl is meegegeven', () => {
    let now = 0;
    const cache = new TtlCache({ defaultTtlSeconds: 10, now: () => now });
    cache.set('a', 1);
    now = 9_999;
    expect(cache.get('a')).toBe(1);
    now = 10_001;
    expect(cache.get('a')).toBeNull();
  });

  it('vervangt het oudste item bij te veel entries (LRU)', () => {
    const cache = new TtlCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' wordt het meest recent gebruikt
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.stats().evictions).toBe(1);
  });

  it('kan per prefix ongeldig maken (bv. na een synchronisatie)', () => {
    const cache = new TtlCache();
    cache.set('offers:lidl', [1]);
    cache.set('offers:dirk', [2]);
    cache.set('prijzen:lidl', [3]);
    expect(cache.invalidatePrefix('offers:')).toBe(2);
    expect(cache.get('offers:lidl')).toBeNull();
    expect(cache.get('offers:dirk')).toBeNull();
    expect(cache.get('prijzen:lidl')).toEqual([3]);
  });

  it('houdt bij hoe oud een entry is, zodat de UI "bijgewerkt om" kan tonen', () => {
    let now = 0;
    const cache = new TtlCache({ now: () => now });
    cache.set('a', 1, 3600);
    now = 45_000;
    expect(cache.ageSeconds('a')).toBe(45);
    expect(cache.ageSeconds('weg')).toBeNull();
  });

  it('telt hits en misses', () => {
    const cache = new TtlCache();
    cache.set('a', 1);
    cache.get('a');
    cache.get('a');
    cache.get('b');
    expect(cache.stats().hits).toBe(2);
    expect(cache.stats().misses).toBe(1);
  });

  it('maakt deterministische cache-sleutels', () => {
    expect(CacheKeys.offers('lidl')).toBe('offers:lidl');
    expect(CacheKeys.storeStatus('dirk')).toBe('status:dirk');
    expect(CacheKeys.productMetadata('5449000000996')).toBe('product:5449000000996');
    expect(createCache()).toBeInstanceOf(TtlCache);
  });
});
