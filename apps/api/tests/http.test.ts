import { describe, expect, it, vi } from 'vitest';
import { HttpClient, SourceError } from '../src/services/http.js';

function makeClient(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    allowNetwork: true,
    timeoutMs: 1000,
    maxRetries: 2,
    retryDelayMs: 0,
    userAgent: 'test',
    sleep: async () => {},
    ...overrides,
  });
}

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
  });
}

describe('HttpClient', () => {
  it('haalt JSON op en geeft de sleutel alleen in de header door', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      return jsonResponse({ offers: [] });
    });

    const client = makeClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.getJson<{ offers: unknown[] }>('https://bron.example/offers', {
      storeId: 'lidl',
      label: 'Lidl offers',
      headers: { Authorization: 'Bearer geheim-token' },
    });

    expect(result).toEqual({ offers: [] });
    expect(calls[0]?.url).toBe('https://bron.example/offers');
    expect(calls[0]?.headers.Authorization).toBe('Bearer geheim-token');
    expect(calls[0]?.headers['User-Agent']).toBe('test');
  });

  it('blokkeert alle verzoeken als netwerkverkeer uit staat', async () => {
    const fetchImpl = vi.fn();
    const client = makeClient({ allowNetwork: false, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(client.getJson('https://bron.example/offers')).rejects.toBeInstanceOf(SourceError);
    expect(fetchImpl).not.toHaveBeenCalled();

    const error = (await client.getJson('https://bron.example/offers').catch((e) => e)) as SourceError;
    expect(error.kind).toBe('geblokkeerd');
    expect(error.userMessage).toContain('ALLOW_NETWORK=false');
  });

  it('probeert opnieuw bij HTTP 429 en slaat daarna op', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) return new Response('te veel verzoeken', { status: 429, statusText: 'Too Many Requests' });
      return jsonResponse({ offers: [{ title: 'Coca-Cola' }] });
    });

    const client = makeClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await client.getJson<{ offers: unknown[] }>('https://bron.example/offers');
    expect(attempts).toBe(3);
    expect(result.offers).toHaveLength(1);
  });

  it('geeft een rate_limit-fout met een duidelijke Nederlandse uitleg', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429, statusText: 'Too Many Requests' }));
    const client = makeClient({ maxRetries: 0, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client.getJson('https://bron.example/offers').catch((e) => e)) as SourceError;
    expect(error.kind).toBe('rate_limit');
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.userMessage).toMatch(/te veel verzoeken/i);
  });

  it('probeert niet opnieuw bij een 4 zonder retry (bv. 401)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401, statusText: 'Unauthorized' }));
    const client = makeClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client.getJson('https://bron.example/offers').catch((e) => e)) as SourceError;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error.kind).toBe('http');
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toMatch(/toegangssleutel|niet geldig/i);
  });

  it('meldt een time-out wanneer het verzoek te lang duurt', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );

    const client = makeClient({ timeoutMs: 10, maxRetries: 0, fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = (await client.getJson('https://bron.example/offers').catch((e) => e)) as SourceError;
    expect(error.kind).toBe('timeout');
    expect(error.userMessage).toMatch(/niet op tijd/i);
  });

  it('meldt een netwerkfout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const client = makeClient({ maxRetries: 0, fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = (await client.getJson('https://bron.example/offers').catch((e) => e)) as SourceError;
    expect(error.kind).toBe('netwerk');
    expect(error.userMessage).toMatch(/geen verbinding/i);
  });

  it('weigert ongeldig JSON in plaats van het te gokken', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>500</html>', { status: 200 }));
    const client = makeClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = (await client.getJson('https://bron.example/offers').catch((e) => e)) as SourceError;
    expect(error.kind).toBe('parse');
    expect(error.userMessage).toMatch(/ander formaat/i);
  });

  it('gebruikt een oplopende wachttijd tussen pogingen', async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn(async () => new Response('', { status: 503, statusText: 'Service Unavailable' }));
    const client = makeClient({
      retryDelayMs: 100,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });

    await client.getJson('https://bron.example/offers').catch(() => {});
    expect(waits).toEqual([100, 200]);
  });

  it('houdt de api-sleutel buiten foutmeldingen', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500, statusText: 'Server Error' }));
    const client = makeClient({ maxRetries: 0, fetchImpl: fetchImpl as unknown as typeof fetch });

    const error = (await client
      .getJson('https://bron.example/offers', { headers: { Authorization: 'Bearer TOPGEHEIM' } })
      .catch((e: SourceError) => e)) as SourceError;

    const serialized = `${error.message} ${error.userMessage} ${error.stack ?? ''}`;
    expect(serialized).not.toContain('TOPGEHEIM');
  });
});
