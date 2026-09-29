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
    await waitFor(() => expect(screen.getByLabelText('Wat heb je nodig?')).toBeTruthy());
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

describe('snel toevoegen', () => {
  it('voegt één product meteen toe, zonder preview', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        quickAdd: {
          added: 1,
          items: [makeItem({ id: 'item-9', name: 'Melk' })],
          suggestions: [],
          message: 'Melk toegevoegd.',
        },
      },
      '/lijst',
    );

    await user.type(await screen.findByLabelText('Wat heb je nodig?'), 'melk');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(server.calls).toContain('/lists/lijst-1/quick-add'));
    expect(server.lastBody('/lists/lijst-1/quick-add')).toEqual({ text: 'melk' });
    // Geen tussenstap: er wordt nooit om bevestiging gevraagd.
    expect(server.calls).not.toContain('/parse');
  });

  it('voegt meerdere producten uit één tekst toe', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        quickAdd: {
          added: 3,
          items: [
            makeItem({ id: 'item-1', name: 'Melk' }),
            makeItem({ id: 'item-2', name: 'Cola' }),
            makeItem({ id: 'item-3', name: 'Blikjes' }),
          ],
          suggestions: [],
          message: '3 producten toegevoegd.',
        },
      },
      '/lijst',
    );

    await user.type(await screen.findByLabelText('Wat heb je nodig?'), 'melk, cola, blikjes');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const body = server.lastBody('/lists/lijst-1/quick-add') as { text: string };
      expect(body.text).toBe('melk, cola, blikjes');
    });
    await waitFor(() => expect(screen.getByText('3 producten toegevoegd.')).toBeTruthy());
  });

  it('leegt het veld weer leeg, zodat je meteen door kunt typen', async () => {
    const { user } = renderApp(
      {
        sources: NO_SOURCES,
        quickAdd: { added: 1, items: [makeItem()], suggestions: [], message: 'Melk toegevoegd.' },
      },
      '/lijst',
    );

    const field = (await screen.findByLabelText('Wat heb je nodig?')) as HTMLInputElement;
    await user.type(field, 'melk');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(field.value).toBe(''));
  });

  it('biedt een koppeling aan zonder het toevoegen tegen te houden', async () => {
    const { server, user } = renderApp(
      {
        sources: NO_SOURCES,
        quickAdd: {
          added: 1,
          items: [makeItem({ id: 'item-7', name: 'Melk', productId: null })],
          suggestions: [
            { itemId: 'item-7', name: 'Melk', candidates: [{ productId: 'p1', name: 'Melk Halfvol 1L', confidence: 0.8 }] },
          ],
          message: 'Melk toegevoegd.',
        },
      },
      '/lijst',
    );

    await user.type(await screen.findByLabelText('Wat heb je nodig?'), 'melk');
    await user.keyboard('{Enter}');

    const knop = await screen.findByRole('button', { name: /Ja, koppelen/ });
    expect(screen.getByText(/Melk toegevoegd/)).toBeTruthy();
    await user.click(knop);

    await waitFor(() => expect(server.calls).toContain('/items/item-7'));
    expect(server.lastBody('/items/item-7')).toEqual({ productId: 'p1' });
  });

  it('verklapt een fout van de server', async () => {
    const server = createFakeServer({ sources: NO_SOURCES });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/quick-add')) {
        return new Response(JSON.stringify({ error: 'Ongeldige aanvraag' }), { status: 400 });
      }
      return server.fetch(input);
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lijst']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText('Wat heb je nodig?'), 'melk');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText(/Dat lukte niet/)).toBeTruthy());
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

describe('navigatie', () => {
  it('heeft alleen de drie schermen die je nodig hebt', async () => {
    renderApp({ sources: NO_SOURCES });
    await waitFor(() => expect(screen.getByRole('heading', { name: /Boodschappen/ })).toBeTruthy());

    const menu = screen.getByRole('navigation', { name: 'Hoofdmenu' });
    const labels = within(menu).getAllByRole('link').map((link) => link.textContent);

    expect(labels).toEqual(['Boodschappen', 'Weekmenu', 'Aanbiedingen']);
  });

  it('opent de boodschappenlijst op het startscherm', async () => {
    const { user } = renderApp({ sources: NO_SOURCES, items: [makeItem()] });

    await waitFor(() => expect(screen.getByLabelText('Wat heb je nodig?')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Melk')).toBeTruthy());

    const menu = screen.getByRole('navigation', { name: 'Hoofdmenu' });
    await user.click(within(menu).getByRole('link', { name: 'Weekmenu' }));
    await user.click(within(menu).getByRole('link', { name: 'Boodschappen' }));
    expect(screen.getByLabelText('Wat heb je nodig?')).toBeTruthy();
  });

  it('stuurt een oude of onbekende link door naar de lijst', async () => {
    renderApp({ sources: NO_SOURCES, items: [makeItem()] }, '/prijzen');
    await waitFor(() => expect(screen.getByLabelText('Wat heb je nodig?')).toBeTruthy());
  });
});
