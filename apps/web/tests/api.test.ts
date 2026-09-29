import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api_, ApiError } from '../src/lib/api.js';

/**
 * De API-client is de enige plek waar de browser met de server praat.
 * Belangrijkste eis: er gaat nooit een api-key mee, en fouten worden
 * begrijpelijk vertaald.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

/** Elke aanroep krijgt een verse Response: een Response kun je maar eens lezen. */
function stubFetch(makeResponse: () => Response) {
  const spy = vi.fn(async () => makeResponse());
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('api-client', () => {
  it('stuurt verzoeken naar /api', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ lists: [] }), { status: 200 }));
    await api_.lists();

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/lists');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('stuurt nooit een api-key mee', async () => {
    // Zelfs als er per ongeluk zo'n variabele in de build terechtkomt,
    // mag de browser die niet doorgeven.
    vi.stubEnv('VITE_API_URL', 'https://api.example');
    vi.stubEnv('VITE_SOURCE_LIDL_API_KEY', 'TOPGEHEIM-TOKEN');
    vi.resetModules();
    const verse = await import('../src/lib/api.js');

    const spy = stubFetch(() => new Response(JSON.stringify({ lists: [] }), { status: 200 }));
    await verse.api_.lists();

    const serialized = JSON.stringify(spy.mock.calls[0]);
    expect(serialized).not.toContain('TOPGEHEIM-TOKEN');
    expect(serialized).toContain('https://api.example/api/lists');
  });

  it('zet de winkel in de aanbiedingsvraag', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ offers: [], count: 0, hasLivePricing: false }), { status: 200 }));
    await api_.offers('albert_heijn');

    expect(String(spy.mock.calls[0]?.[0])).toContain('storeId=albert_heijn');
  });

  it('zet meerdere winkels in de optimalisatievraag', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    await api_.optimize('lijst-1', ['lidl', 'dirk']);

    expect(String(spy.mock.calls[0]?.[0])).toContain('stores=lidl,dirk');
  });

  it('laat winkels weg als er geen filter is', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    await api_.optimize('lijst-1');

    expect(String(spy.mock.calls[0]?.[0])).not.toContain('stores=');
  });

  it('vertaalt een serverfout naar iets leesbaars', async () => {
    stubFetch(() => new Response(JSON.stringify({ message: 'Lijst bestaat niet' }), { status: 404 }));

    await expect(api_.list('onzin')).rejects.toBeInstanceOf(ApiError);
    await expect(api_.list('onzin')).rejects.toMatchObject({
      status: 404,
      message: 'Lijst bestaat niet',
    });
  });

  it('verbergt de ruwe serverfout bij een storing', async () => {
    stubFetch(() => new Response(JSON.stringify({ message: 'stacktrace met interne paden' }), { status: 500 }));

    const error = await api_.lists().catch((cause: unknown) => cause as ApiError);
    // De gebruiker krijgt iets bruikbaars, niet de interne melding.
    expect(error.userMessage).not.toContain('stacktrace');
    expect(error.userMessage).toMatch(/probleem/i);
  });

  it('meldt een ontbrekende server', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const error = await api_.lists().catch((cause: unknown) => cause as ApiError);
    expect(error.status).toBe(0);
    expect(error.userMessage).toMatch(/geen verbinding/i);
  });

  it('leest ook een 204 zonder inhoud', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(api_.deleteItem('item-1')).resolves.toBeUndefined();
  });

  it('verwerkt een leeg antwoord als "geen inhoud"', async () => {
    stubFetch(() => new Response('', { status: 200 }));
    await expect(api_.lists()).resolves.toBeNull();
  });
});

describe('foutberichten', () => {
  it('noemt de oorzaak bij een 4xx', () => {
    expect(new ApiError(400, 'Ongeldige invoer').userMessage).toBe('Ongeldige invoer');
  });
});
