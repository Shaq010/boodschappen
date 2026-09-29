/**
 * Lokale testfeed voor de Playwright-tests.
 *
 * Dit is een testdubbel voor een geautoriseerde prijsbron, geen productdata:
 * de app zelf bevat geen voorbeeldprijzen. De tests hebben hiermee een echte
 * bron nodig om het geladen pad te oefenen — sync, opslaan, koppelen, tonen.
 *
 * Vormgegeven volgens het contract in docs/DATA_SOURCES.md: prijzen in euro's,
 * verpakkingsgrootte in `packQuantity`.
 */

import { createServer } from 'node:http';

const OFFERS = [
  {
    storeProductId: 'e2e-melk',
    gtin: '8719200012345',
    title: 'Melk 1 l',
    category: 'zuivel',
    packDescription: '1 liter',
    packQuantity: 1,
    packUnit: 'l',
    offerPrice: 1.19,
    regularPrice: 1.49,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
  },
  {
    storeProductId: 'e2e-bananen',
    gtin: '8719200056789',
    title: 'Bananen 1 kg',
    category: 'groente',
    packDescription: '1 kilo',
    packQuantity: 1,
    packUnit: 'kg',
    offerPrice: 1.79,
    regularPrice: 2.19,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
  },
  {
    storeProductId: 'e2e-cola',
    gtin: '8719200099999',
    title: 'Coca-Cola regular 1,5 l',
    category: 'dranken',
    packDescription: '1,5 liter',
    packQuantity: 1.5,
    packUnit: 'l',
    offerPrice: 2.19,
    regularPrice: 2.79,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
  },
  {
    // Met loyaltyvoorwaarde: de app moet dit expliciet tonen, niet als
    // gewone actieprijs.
    storeProductId: 'e2e-kaas',
    gtin: '8719200044444',
    title: 'Goudse kaas 200 g',
    category: 'zuivel',
    packDescription: '200 gram',
    packQuantity: 200,
    packUnit: 'g',
    offerPrice: 2.49,
    regularPrice: 3.19,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    conditions: { requiresLoyaltyCard: true, loyaltyCardName: 'Mijn AH' },
  },
];

const PRICES = [
  {
    storeProductId: 'e2e-melk',
    gtin: '8719200012345',
    title: 'Melk 1 l',
    price: 1.19,
    currency: 'EUR',
    packQuantity: 1,
    packUnit: 'l',
  },
  {
    storeProductId: 'e2e-bananen',
    gtin: '8719200056789',
    title: 'Bananen 1 kg',
    price: 1.79,
    currency: 'EUR',
    packQuantity: 1,
    packUnit: 'kg',
  },
];

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;

  // Startsignaal voor Playwright: geen sleutel nodig, dus een echte 200.
  if (path === '/health') {
    json(response, 200, { ok: true, offers: OFFERS.length });
    return;
  }

  // De adapter stuurt een bearer-token mee. We controleren dat het klopt, zodat
  // een test ook kan bewijzen dat een sleutel niets oplevert zonder.
  const auth = request.headers.authorization;
  if (auth !== 'Bearer e2e-test-key') {
    json(response, 401, { error: 'unauthorized' });
    return;
  }

  if (path === '/offers') {
    json(response, 200, { offers: OFFERS });
    return;
  }
  if (path === '/prices') {
    json(response, 200, { prices: PRICES });
    return;
  }
  json(response, 404, { error: 'not_found' });
});

const port = Number(process.env.E2E_FEED_PORT ?? 4500);
server.listen(port, '127.0.0.1', () => {
  console.log(`[e2e-feed] luistert op http://127.0.0.1:${port}`);
});
