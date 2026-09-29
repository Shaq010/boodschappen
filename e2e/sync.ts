import { expect, type APIRequestContext } from '@playwright/test';

const BASE = 'http://127.0.0.1:4100/api';

/**
 * Start een sync en wacht tot geen enkele winkel meer 'syncing' is.
 *
 * De API antwoordt sinds de achtergrondsync meteen met 202; het werk duurt
 * daarna nog minuten verder. Deze helper wacht dat af, zodat de tests van
 * een afgeronde sync uitgaan in plaats van van een net begonnen één.
 */
export async function syncAndWait(request: APIRequestContext): Promise<void> {
  const sync = await request.post(`${BASE}/sources/sync`, { data: {} });
  expect(sync.ok(), 'sync tegen de testfeed, niet al bezig').toBe(true);

  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    const response = await request.get(`${BASE}/sources`);
    const body = (await response.json()) as { sources: Array<{ status: string }> };
    if (!body.sources.some((source) => source.status === 'syncing')) return;

    if (Date.now() > deadline) {
      throw new Error('De sync is niet binnen drie minuten klaar');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}