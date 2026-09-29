import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../src/App.js';
import {
  createFakeServer,
  emptyMenu,
  emptyOptimization,
  makeItem,
  makeQuote,
  makeQuoteFor,
  type FakeServerOptions,
} from './fake-server.js';

/**
 * Schermtests: controleren dat de app doet wat ze belooft.
 *
 * Vooral de beloftes rond "geen verzonnen prijzen" worden hier getest: lege
 * prijzen moeten leeg blijven en uitleg geven, nooit € 0,00 tonen.
 */

function renderApp(options: FakeServerOptions = {}, route = '/') {
  const server = createFakeServer(options);
  vi.stubGlobal('fetch', server.fetch);
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  return { server, user };
}

const NO_SOURCES = {
  sources: [
    {
      storeId: 'lidl', storeName: 'Lidl', status: 'not_configured',
      message: 'Geen officiële bron gekoppeld.', offerCount: 0, priceCount: 0,
      lastSuccessAt: null, lastAttemptAt: null, lastError: null, ageSeconds: null,
      documentationUrl: null, requiredEnvVars: ['SOURCE_LIDL_BASE_URL'], requiredConfiguration: [],
    },
  ],
  configuredCount: 0,
  totalStores: 4,
  hasLivePricing: false,
};

describe('opstarten', () => {
  it('laat zien dat de server bereikbaar is', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Goed/g })).toBeTruthy());
  });

  it('legt uit wat te doen als de server uit staat', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });

    render(
      <MemoryRouter>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/niet bereiken/i)).toBeTruthy();
  });
});

describe('dashboard', () => {
  it('toont de vier winkels en zegt eerlijk dat er geen bron is', async () => {
    renderApp({ sources: NO_SOURCES });

    await waitFor(() => expect(screen.getByText('Databronnen')).toBeTruthy());
    expect(screen.getByText('Lidl')).toBeTruthy();
    expect(screen.getByText('Niet gekoppeld')).toBeTruthy();
    expect(screen.getByText(/geen officiële bron gekoppeld/i)).toBeTruthy();
  });

  it('vraagt om een lijst als er nog geen is', async () => {
    renderApp({ sources: NO_SOURCES, lists: [] });
    await waitFor(() => expect(screen.getAllByText(/Nog geen lijst/i).length).toBeGreaterThan(0));
  });

  it('noemt een uitgezet netwerk als stand van zaken, niet als fout', async () => {
    renderApp({
      sources: {
        sources: [
          {
            storeId: 'lidl', storeName: 'Lidl', status: 'network_disabled',
            message: 'Uitgaande verzoeken staan uit (ALLOW_NETWORK=false).',
            offerCount: 0, priceCount: 0, lastSuccessAt: null, lastAttemptAt: null,
            lastError: null, ageSeconds: null, documentationUrl: null,
            requiredEnvVars: ['SOURCE_LIDL_BASE_URL'], requiredConfiguration: [],
          },
        ],
        configuredCount: 1,
        totalStores: 4,
        hasLivePricing: false,
      },
    });

    await waitFor(() => expect(screen.getByText('Netwerk staat uit')).toBeTruthy());
    expect(screen.getByText(/netwerk staat uit, dus er worden geen prijzen opgehaald/i)).toBeTruthy();
  });

  it('telt openstaande producten', async () => {
    renderApp({
      sources: NO_SOURCES,
      items: [makeItem({ id: 'a', name: 'Melk', checked: false }), makeItem({ id: 'b', name: 'Brot', checked: true })],
    });

    await waitFor(() => expect(screen.getByText(/1 van 2 producten nog te gaan/)).toBeTruthy());
  });
});

describe('boodschappenlijst', () => {
  it('toont de beste prijs en de winkel', async () => {
    renderApp(
      {
        sources: NO_SOURCES,
        items: [makeItem({ best: makeQuote(), quotes: [makeQuote()] })],
      },
      '/lijst',
    );

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    expect(screen.getAllByText(/€\s1[,.]00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lidl').length).toBeGreaterThan(0);
  });

  it('waarschuwt bij voorwaarden bij de prijs', async () => {
    renderApp(
      {
        sources: NO_SOURCES,
        items: [
          makeItem({
            best: makeQuote({ warnings: ['Alleen met klantenkaart.'] }),
            quotes: [makeQuote({ warnings: ['Alleen met klantenkaart.'] })],
          }),
        ],
      },
      '/lijst',
    );

    await waitFor(() => expect(screen.getByText('Alleen met klantenkaart.')).toBeTruthy());
  });

  it('zegt het als er geen prijs bekend is, in plaats van € 0,00 te tonen', async () => {
    renderApp({ sources: NO_SOURCES, items: [makeItem()] }, '/lijst');

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    expect(screen.getByText(/Nog geen prijs bekend/)).toBeTruthy();
    expect(screen.queryByText('€ 0,00')).toBeNull();
  });

  it('zet een regel af en vinkt hem af', async () => {
    const { server, user } = renderApp({ sources: NO_SOURCES, items: [makeItem()] }, '/lijst');

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Melk afvinken/ }));

    await waitFor(() => expect(server.calls).toContain('/items/item-1'));
    expect(server.lastBody('/items/item-1')).toEqual({ checked: true });
  });

  it('verwijdert een regel', async () => {
    const { server, user } = renderApp({ sources: NO_SOURCES, items: [makeItem()] }, '/lijst');

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Melk verwijderen/ }));

    await waitFor(() => expect(server.calls).toContain('/items/item-1'));
  });

  it('laat zien dat er zonder prijzen niets te vergelijken valt', async () => {
    renderApp({ sources: NO_SOURCES, items: [makeItem()], optimization: emptyOptimization() }, '/lijst');

    await waitFor(() => expect(screen.getByText('Waar kan ik het goedkoopst winkelen?')).toBeTruthy());
    expect(screen.getByText(/Nog geen prijzen om te vergelijken/)).toBeTruthy();
  });

  it('toont de winkelmix met de voorwaarde erbij', async () => {
    const plan = {
      key: 'combo', title: 'Goedkoopste combinatie', description: 'Bij twee winkels.', total: 2.28,
      pricedItemCount: 2, unpricedItemCount: 0, isComplete: false, missingItems: ['Brood'],
      storeIds: ['lidl', 'dirk'],
      lines: [
        { storeId: 'lidl', itemCount: 1, subtotal: 1.0, items: [{ itemId: 'a', itemName: 'Melk', cost: 1, quantity: '2 stuk', label: 'Actieprijs', warnings: [] }] },
        { storeId: 'dirk', itemCount: 1, subtotal: 1.28, items: [{ itemId: 'b', itemName: 'Bier', cost: 1.28, quantity: '6 stuk', label: 'Actieprijs', warnings: [] }] },
      ],
    };

    renderApp(
      {
        sources: NO_SOURCES,
        items: [makeItem()],
        optimization: { ...emptyOptimization(), cheapestCombination: plan, minimalStores: { ...plan, key: 'minimal', title: 'Zo min mogelijk winkels (2)' }, cheapestTotal: 2.28, totalPricedItems: 1, unpriced: [{ itemId: 'b', name: 'Brood', reason: 'Geen prijs bij deze winkels.' }] },
      },
      '/lijst',
    );

    await waitFor(() => expect(screen.getByText('Goedkoopste combinatie')).toBeTruthy());
    expect(screen.getAllByText(/Niet verkrijgbaar in dit plan: Brood/).length).toBe(2);
    expect(screen.getByText(/Het totaal is niet compleet/)).toBeTruthy();
    expect(screen.getAllByText(/€\s2[,.]28/).length).toBe(2);
  });
});

describe('bulk invoeren', () => {
  it('laat eerst een preview zien en pas na bevestigen opslaan', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        parse: {
          items: [
            { name: 'Melk', normalizedName: 'melk', quantity: { dimension: 'count', amount: 2, unit: 'st' }, suggestedProductId: 'p1', suggestedProductName: 'Melk', confidence: 1, needsConfirmation: false, candidates: [], inPantry: false, pantryAmount: null },
            { name: 'Bier', normalizedName: 'bier', quantity: { dimension: 'count', amount: 6, unit: 'st' }, suggestedProductId: null, suggestedProductName: null, confidence: 0.4, needsConfirmation: true, candidates: [{ productId: 'p9', name: 'Pils', confidence: 0.4 }], inPantry: false, pantryAmount: null },
          ],
          message: '2 regels gevonden. Controleer ze.',
          raw: { ignored: [] },
        },
      },
      '/lijst',
    );

    await user.click(await screen.findByRole('button', { name: /Bulk invoeren/ }));

    const textarea = await screen.findByLabelText('Tekst met boodschappen');
    await user.type(textarea, '2 melk, 6 bier');
    await user.click(screen.getByRole('button', { name: /Analyseer/ }));

    await waitFor(() => expect(screen.getByText(/2 regels gevonden/)).toBeTruthy());
    // Pas na bevestigen wordt er iets bewaard.
    expect(server.calls).not.toContain('/lists/lijst-1/import');

    await user.click(screen.getByRole('button', { name: /2 product\(en\) toevoegen/ }));
    await waitFor(() => expect(server.calls).toContain('/lists/lijst-1/import'));
  });

  it('laat een regel weg als je die weghaalt', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        parse: {
          items: [
            { name: 'Melk', normalizedName: 'melk', quantity: { dimension: 'count', amount: 2, unit: 'st' }, suggestedProductId: 'p1', suggestedProductName: 'Melk', confidence: 1, needsConfirmation: false, candidates: [], inPantry: false, pantryAmount: null },
            { name: 'Bier', normalizedName: 'bier', quantity: { dimension: 'count', amount: 6, unit: 'st' }, suggestedProductId: null, suggestedProductName: null, confidence: 0.4, needsConfirmation: true, candidates: [], inPantry: false, pantryAmount: null },
          ],
          message: '2 regels gevonden.',
          raw: { ignored: [] },
        },
      },
      '/lijst',
    );

    await user.click(await screen.findByRole('button', { name: /Bulk invoeren/ }));
    await user.type(await screen.findByLabelText('Tekst met boodschappen'), '2 melk, 6 bier');
    await user.click(screen.getByRole('button', { name: /Analyseer/ }));

    await waitFor(() => expect(screen.getByText(/2 van 2 regel/)).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Melk overslaan' }));
    expect(screen.getByText(/1 van 2 regel/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /1 product\(en\) toevoegen/ }));
    await waitFor(() => {
      const body = server.lastBody('/lists/lijst-1/import') as { items: Array<{ name: string }> };
      expect(body.items.map((item) => item.name)).toEqual(['Bier']);
    });
  });

  it('markeert wat al in de voorraadkast ligt', async () => {
    const { user } = renderApp(
      {
        sources: NO_SOURCES,
        pantry: [{ id: 'x', name: 'Melk', normalizedName: 'melk', dimension: 'count', amount: 2, unit: 'st' }],
        parse: {
          items: [
            { name: 'Melk', normalizedName: 'melk', quantity: { dimension: 'count', amount: 2, unit: 'st' }, suggestedProductId: 'p1', suggestedProductName: 'Melk', confidence: 1, needsConfirmation: false, candidates: [], inPantry: true, pantryAmount: 2 },
          ],
          message: '1 regel.',
          raw: { ignored: [] },
        },
      },
      '/lijst',
    );

    await user.click(await screen.findByRole('button', { name: /Bulk invoeren/ }));
    await user.type(await screen.findByLabelText('Tekst met boodschappen'), '2 melk');
    await user.click(screen.getByRole('button', { name: /Analyseer/ }));

    await waitFor(() => expect(screen.getByText(/In voorraad \(2 st\)/)).toBeTruthy());
  });
});

describe('aanbiedingen', () => {
  it('verklapt waarom de pagina leeg is zonder bron', async () => {
    renderApp({ sources: NO_SOURCES, offers: [] }, '/aanbiedingen');

    await waitFor(() => expect(screen.getByText(/Nog geen bron gekoppeld/)).toBeTruthy());
    expect(screen.getByText(/geen openbare API voor prijzen/)).toBeTruthy();
    expect(screen.queryByText(/€\s*0,00/)).toBeNull();
  });

  it('toont aanbiedingen met korting en voorwaarden', async () => {
    renderApp(
      {
        sources: { ...NO_SOURCES, hasLivePricing: true },
        offers: [
          {
            id: 'o1', storeId: 'lidl', storeName: 'Lidl', productId: 'p1', title: 'Melk 1 l',
            description: null, kind: 'second_half',
            conditions: { requiresLoyaltyCard: true, loyaltyCardName: 'Mijn AH' },
            offerPriceCents: 50, regularPriceCents: 100, currency: 'EUR',
            validFrom: '2026-01-01', validUntil: '2026-01-14', packDescription: '2 flesjes',
            sourceName: 'Lidl feed', sourceConfigured: true,
          },
        ],
      },
      '/aanbiedingen',
    );

    await waitFor(() => expect(screen.getByText('Melk 1 l')).toBeTruthy());
    expect(screen.getAllByText(/€\s0[,.]50/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/€\s1[,.]00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Tweede halve prijs')).toBeTruthy();
    // De kaartnaam moet zichtbaar zijn: 'een prijs die alleen met een kaart
    // geldt' mag nooit ogen als een prijs voor iedereen.
    expect(screen.getByText(/Alleen met Mijn AH/)).toBeTruthy();
    expect(screen.getByText(/Geldig tot/)).toBeTruthy();
  });

  it('filtert op zoekterm', async () => {
    const { user } = renderApp(
      {
        sources: { ...NO_SOURCES, hasLivePricing: true },
        offers: [
          { id: 'o1', storeId: 'lidl', storeName: 'Lidl', productId: 'p1', title: 'Melk 1 l', description: null, kind: 'price_drop', conditions: {}, offerPriceCents: 50, regularPriceCents: 100, currency: 'EUR', validFrom: null, validUntil: null, packDescription: null, sourceName: null, sourceConfigured: true },
          { id: 'o2', storeId: 'dirk', storeName: 'Dirk', productId: 'p2', title: 'Bier 6-pack', description: null, kind: 'price_drop', conditions: {}, offerPriceCents: 500, regularPriceCents: 700, currency: 'EUR', validFrom: null, validUntil: null, packDescription: null, sourceName: null, sourceConfigured: true },
        ],
      },
      '/aanbiedingen',
    );

    await waitFor(() => expect(screen.getByText('Melk 1 l')).toBeTruthy());
    await user.type(screen.getByLabelText('Zoeken'), 'bier');

    await waitFor(() => expect(screen.queryByText('Melk 1 l')).toBeNull());
    expect(screen.getByText('Bier 6-pack')).toBeTruthy();
  });
});

describe('prijsvergelijking', () => {
  it('toont een lege tabel met streepjes zonder prijzen', async () => {
    renderApp({ sources: NO_SOURCES, items: [makeItem()] }, '/prijzen');

    // Wachten tot de regels er echt staan: de lijst komt asynchroon binnen.
    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    // Streepje in plaats van een bedrag: er is geen prijs, dus toon niets.
    const row = screen.getByText('Melk').closest('tr');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getAllByText('—').length).toBe(4);
  });

  it('markeert de goedkoopste winkel', async () => {
    renderApp(
      {
        sources: { ...NO_SOURCES, hasLivePricing: true },
        items: [
          makeItem({
            quotes: [
              makeQuote({ basketCost: 1.29, unitPrice: 0.65 }),
              makeQuoteFor('dirk', 'Dirk', { basketCost: 0.99, unitPrice: 0.5 }),
            ],
            best: makeQuoteFor('dirk', 'Dirk', { basketCost: 0.99 }),
          }),
        ],
      },
      '/prijzen',
    );

    await waitFor(() => expect(screen.getByText('goedkoopst')).toBeTruthy());
    expect(screen.getAllByText(/€\s0[,.]99/).length).toBeGreaterThan(0);
  });

  it('stuurt de gekozen winkels mee', async () => {
    const { server, user } = renderApp({ sources: NO_SOURCES, items: [makeItem()] }, '/prijzen');

    const berekenen = screen.getByRole('button', { name: /Bereken beste winkelmix/ });
    // De knop wordt pas actief als de lijst binnen is.
    await waitFor(() => expect(berekenen.hasAttribute('disabled')).toBe(false));

    await user.click(screen.getByRole('checkbox', { name: 'Dirk' }));
    await user.click(screen.getByRole('checkbox', { name: 'Kruidvat' }));
    await user.click(berekenen);

    await waitFor(() => expect(server.calls.some((call) => call.includes('stores=lidl,albert_heijn'))).toBe(true));
  });
});

describe('weekmenu', () => {
  it('toont de dagen van de week', async () => {
    renderApp({ sources: NO_SOURCES, menu: emptyMenu() }, '/menu');

    await waitFor(() => expect(screen.getAllByText('maandag').length).toBeGreaterThan(0));
    expect(screen.getAllByText('zondag').length).toBeGreaterThan(0);
    expect(screen.getByText('Nog niets gepland')).toBeTruthy();
  });

  it('markeert ingrediënten die je al hebt', async () => {
    renderApp(
      {
        sources: NO_SOURCES,
        menu: {
          ...emptyMenu(),
          shopping: [{ name: 'Melk', amount: 1000, unit: 'ml', dimension: 'volume', inPantry: true, pantryAmount: 1000, toBuy: false }],
        },
      },
      '/menu',
    );

    await waitFor(() => expect(screen.getByText('Wat heb je nodig?')).toBeTruthy());
    expect(screen.getByText('Heb ik')).toBeTruthy();
    expect(screen.getByText(/in voorraad: 1000 ml/)).toBeTruthy();
  });

  it('voegt een gerecht toe', async () => {
    const { server, user } = renderApp({ sources: NO_SOURCES, menu: emptyMenu() }, '/menu');

    await waitFor(() => expect(screen.getByText('Gerecht toevoegen')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('Dag'), 'donderdag');
    await user.type(screen.getByLabelText('Gerecht'), 'Pasta met tomatensaus');
    await user.type(screen.getByLabelText('Ingrediënten (optioneel)'), 'pasta 500 g, ui 2 st');
    await user.click(screen.getByRole('button', { name: /Toevoegen/ }));

    await waitFor(() => expect(server.calls).toContain('/menu/meals'));
    expect(server.lastBody('/menu/meals')).toEqual({
      day: 'donderdag',
      name: 'Pasta met tomatensaus',
      ingredients: [
        { name: 'pasta', amount: 500, unit: 'g' },
        { name: 'ui', amount: 2, unit: 'st' },
      ],
    });
  });
});

describe('voorraad', () => {
  it('voegt een product toe aan de voorraadkast', async () => {
    const { server, user } = renderApp({ sources: NO_SOURCES, pantry: [] }, '/voorraad');

    await waitFor(() => expect(screen.getByText('In voorraad')).toBeTruthy());
    await user.type(screen.getByLabelText('Product'), 'melk');
    await user.clear(screen.getByLabelText('Aantal'));
    await user.type(screen.getByLabelText('Aantal'), '1,5');
    await user.clear(screen.getByLabelText('Eenheid'));
    await user.type(screen.getByLabelText('Eenheid'), 'l');
    await user.click(screen.getByRole('button', { name: 'Toevoegen' }));

    await waitFor(() => expect(server.calls).toContain('/pantry'));
    // Komma-decimaal moet als 1,5 doorgaan, niet als 15.
    expect(server.lastBody('/pantry')).toEqual({ name: 'melk', amount: 1.5, unit: 'l' });
  });

  it('haalt een product uit de voorraadkast', async () => {
    const { server, user } = renderApp(
      { sources: NO_SOURCES, pantry: [{ id: 'p1', name: 'Melk', normalizedName: 'melk', dimension: 'count', amount: 2, unit: 'st' }] },
      '/voorraad',
    );

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Melk uit voorraad halen' }));

    await waitFor(() => expect(server.calls).toContain('/pantry/p1'));
  });
});

describe('instellingen', () => {
  it('laat zien welke variabelen nodig zijn, zonder de sleutel zelf', async () => {
    renderApp({ sources: NO_SOURCES }, '/instellingen');

    await waitFor(() => expect(screen.getByText('Databronnen per winkel')).toBeTruthy());
    expect(screen.getByText('SOURCE_LIDL_BASE_URL')).toBeTruthy();
    expect(screen.queryByText(/TOPGEHEIM/)).toBeNull();
  });

  it('legt uit dat het netwerk uit staat, zonder het als fout te tonen', async () => {
    renderApp(
      {
        sources: {
          sources: [
            {
              storeId: 'lidl', storeName: 'Lidl', status: 'network_disabled',
              message: 'Uitgaande verzoeken staan uit (ALLOW_NETWORK=false).',
              offerCount: 0, priceCount: 0, lastSuccessAt: null, lastAttemptAt: null,
              lastError: null, ageSeconds: null, documentationUrl: null,
              requiredEnvVars: ['SOURCE_LIDL_BASE_URL'], requiredConfiguration: [],
            },
          ],
          configuredCount: 1,
          totalStores: 4,
          hasLivePricing: false,
        },
      },
      '/instellingen',
    );

    await waitFor(() => expect(screen.getByText('Netwerk staat uit')).toBeTruthy());
    expect(screen.getByText(/Dit is geen fout/)).toBeTruthy();
    expect(screen.getByText('ALLOW_NETWORK=true')).toBeTruthy();
  });

  it('laat een product bevestigen', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        products: { products: [{ id: 'p1', name: 'Melk', category: 'zuivel', verified: false, source: 'onbekend' }], unverified: 1 },
      },
      '/instellingen',
    );

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Bevestigen/ }));

    await waitFor(() => expect(server.calls).toContain('/products/p1/confirm'));
  });

  it('voegt een extra naam toe aan een product', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        products: { products: [{ id: 'p1', name: 'Melk', category: 'zuivel', verified: false, source: 'onbekend' }], unverified: 1 },
      },
      '/instellingen',
    );

    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Naam toevoegen/ }));
    await user.type(screen.getByLabelText('Extra naam'), 'die halve melk');
    await user.click(screen.getByRole('button', { name: 'Opslaan' }));

    await waitFor(() => expect(server.calls).toContain('/products/p1/alias'));
    expect(server.lastBody('/products/p1/alias')).toEqual({ alias: 'die halve melk' });
  });
});

describe('navigatie', () => {
  it('komt op elke pagina via de navigatie', async () => {
    const { user } = renderApp({ sources: NO_SOURCES });
    await waitFor(() => expect(screen.getByRole('heading', { name: /Goed/g })).toBeTruthy());

    const menu = screen.getByRole('navigation', { name: 'Hoofdmenu' });

    await user.click(within(menu).getByRole('link', { name: 'Aanbiedingen' }));
    expect(screen.getByRole('heading', { name: 'Aanbiedingen' })).toBeTruthy();

    await user.click(within(menu).getByRole('link', { name: 'Voorraad' }));
    expect(screen.getByRole('heading', { name: 'Voorraad' })).toBeTruthy();

    await user.click(within(menu).getByRole('link', { name: 'Instellingen' }));
    expect(screen.getByRole('heading', { name: 'Instellingen' })).toBeTruthy();
  });
});
