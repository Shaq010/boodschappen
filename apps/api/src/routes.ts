/**
 * HTTP-routes.
 *
 * Regels die overal gelden:
 *  - Er komt nooit een geheim in een antwoord. De enige plek die dat kan
 *    bewaken is `publicConfig()`; alle andere antwoorden bestaan uit
 *    winkelinformatie, prijzen en gebruikersgegevens.
 *  - Een winkel zonder bron geeft een lege lijst mét uitleg, nooit verzonnen
 *    prijzen. De velden `hasData` en `dataSourceStatus` zeggen wat je ziet.
 *  - Fouten krijgen een Nederlandse uitleg en een passende HTTP-status.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { STORE_IDS, storeIdSchema } from '@boodschappen/core';
import type { App } from './app.js';
import { storeNameFor } from './adapters/types.js';

const userId = (app: App): string => app.config.defaultUser.id;

/**
 * Registreert alle routes onder de API-prefix. De routes zelf staan in een
 * eigen plugin, zodat de prefix op één plek staat.
 */
export async function registerRoutes(server: FastifyInstance, app: App): Promise<void> {
  await server.register(registerApiRoutes(app), { prefix: app.config.server.apiPrefix });
}

function registerApiRoutes(app: App) {
  return async function apiRoutes(api: FastifyInstance): Promise<void> {

  // ---------------------------------------------------------------------------
  // Status en gezondheid
  // ---------------------------------------------------------------------------

  api.get('/health', async () => ({
    status: 'ok',
    stores: STORE_IDS.length,
    database: 'connected',
  }));

  /** De enige route die configuratie toont: zonder enig geheim. */
  api.get('/config', async () => app.publicConfig);

  /** Status van alle winkels: gekoppeld, niet gekoppeld, fout, oftewel. */
  api.get('/sources', async () => {
    const statuses = app.sync.statuses();
    return {
      sources: statuses,
      configuredCount: statuses.filter((s) => s.status === 'connected').length,
      totalStores: STORE_IDS.length,
      /** Zolang dit 0 is, zijn er geen live prijzen. */
      hasLivePricing: statuses.some((s) => s.offerCount > 0 || s.priceCount > 0),
    };
  });

  /**
   * Handmatig ophalen van één winkel of van alle winkels.
   *
   * Antwoordt meteen met 202; het ophalen zelf loopt op de achtergrond. Een
   * volledige run duurt ruim twee minuten en zou anders tegen de time-out van
   * de host aanlopen, met een mislukteknop als gevolg. De voortgang volg je via
   * `GET /sources`, dat tijdens de run `syncing` laat zien.
   */
  api.post('/sources/sync', async (request, reply) => {
    const body = z
      .object({ storeId: storeIdSchema.optional() })
      .safeParse(request.body ?? {});

    if (!body.success) {
      return reply.status(400).send({
        error: 'Ongeldige aanvraag',
        details: body.error.flatten(),
        message: `Geef een geldige winkel mee: ${STORE_IDS.join(', ')}.`,
      });
    }

    const run = app.sync.startInBackground({ storeId: body.data.storeId });
    if (!run) {
      return reply.status(409).send({
        error: 'Al bezig',
        message: 'Er loopt al een update. Even wachten tot die klaar is.',
      });
    }

    // De winkel(en) direct laten weten dat ze gezocht worden, zodat de
    // interface niet stiekem de vorige prijzen blijft tonen als "vers".
    const targets = body.data.storeId ? [body.data.storeId] : STORE_IDS;
    for (const storeId of targets) {
      app.sync.markSyncing(storeId);
    }

    return reply.status(202).send({
      started: true,
      stores: targets,
      message:
        targets.length === 1
          ? `Bezig met bijwerken van ${storeNameFor(targets[0]!)}.`
          : `Bezig met bijwerken van ${targets.length} winkels. Dit kan een paar minuten duren.`,
    });
  });

  // ---------------------------------------------------------------------------
  // Aanbiedingen en prijzen
  // ---------------------------------------------------------------------------

  /** Aanbiedingen uit de database, met de status van de bron erbij. */
  api.get('/offers', async (request) => {
    const query = z
      .object({
        storeId: storeIdSchema.optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(request.query ?? {});

    const rows = app.db.select().from(app.db._.fullSchema.offers).limit(query.limit).all();
    const filtered = query.storeId ? rows.filter((row) => row.storeId === query.storeId) : rows;

    return {
      offers: filtered.map((row) => ({
        id: row.id,
        storeId: row.storeId,
        storeName: row.storeName,
        productId: row.productId,
        title: row.title,
        description: row.description,
        kind: row.kind,
        conditions: row.conditions,
        offerPriceCents: row.offerPriceCents,
        regularPriceCents: row.regularPriceCents,
        currency: row.currency,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        packDescription: row.packDescription,
        sourceName: row.sourceName,
        // Zonder bron weten we niets; toon dat expliciet.
        sourceConfigured: app.registry.get(row.storeId as (typeof STORE_IDS)[number]).isConfigured(),
      })),
      count: filtered.length,
      hasLivePricing: filtered.length > 0,
    };
  });

  /** Beschikbare winkels, inclusief loyaliteitskaart. */
  api.get('/stores', async () => {
    const stores = app.db.select().from(app.db._.fullSchema.stores).all();
    return {
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        shortName: store.shortName,
        website: store.website,
        color: store.color,
        loyaltyCardName: store.loyaltyCardName,
        order: store.displayOrder,
        configured: app.registry.get(store.id as (typeof STORE_IDS)[number]).isConfigured(),
      })),
    };
  });

  // ---------------------------------------------------------------------------
  // Boodschappenlijsten
  // ---------------------------------------------------------------------------

  api.get('/lists', async () => ({ lists: app.shopping.lists(userId(app)) }));

  api.post('/lists', async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(120).default('Mijn boodschappen') }).safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Ongeldige aanvraag', details: body.error.flatten() });
    return reply.status(201).send({ list: app.shopping.createList(userId(app), body.data.name) });
  });

  api.get('/lists/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    const list = app.shopping.list(id);
    if (!list) return reply.status(404).send({ error: 'Lijst niet gevonden' });
    return {
      list,
      items: app.shopping.details(id),
    };
  });

  api.patch('/lists/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body ?? {});
    return { list: app.shopping.renameList(id, body.name) };
  });

  api.delete('/lists/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    app.shopping.deleteList(id);
    return reply.status(204).send();
  });

  api.post('/lists/:id/items', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    const body = z
      .object({
        name: z.string().min(1).max(200),
        amount: z.number().positive().optional(),
        unit: z.string().min(1).max(20).optional(),
        note: z.string().max(500).nullable().optional(),
        inPantry: z.boolean().optional(),
      })
      .safeParse(request.body ?? {});

    if (!body.success) return reply.status(400).send({ error: 'Ongeldige aanvraag', details: body.error.flatten() });

    const { makeQuantity } = await import('@boodschappen/core');
    return reply.status(201).send({
      item: app.shopping.addItem(id, {
        name: body.data.name,
        ...(body.data.amount && body.data.unit
          ? { quantity: makeQuantity(body.data.amount, body.data.unit) }
          : {}),
        note: body.data.note ?? null,
        inPantry: body.data.inPantry ?? false,
      }),
    });
  });

  api.patch('/items/:id', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        amount: z.number().positive().optional(),
        unit: z.string().min(1).max(20).optional(),
        checked: z.boolean().optional(),
        inPantry: z.boolean().optional(),
        note: z.string().max(500).nullable().optional(),
      })
      .parse(request.body ?? {});

    const item = app.shopping.updateItem(id, body);
    return { item };
  });

  api.delete('/items/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    app.shopping.deleteItem(id);
    return reply.status(204).send();
  });

  /**
   * Parser: leest vrije tekst en geeft een preview terug. Er wordt pas iets
   * opgeslagen na bevestiging, zodat een verkeerde interpretatie herstelbaar is.
   */
  api.post('/parse', async (request, reply) => {
    const body = z.object({ text: z.string().min(1).max(20_000) }).safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Ongeldige aanvraag', details: body.error.flatten() });

    const preview = app.shopping.preview(body.data.text, userId(app));
    return {
      ...preview,
      message: preview.items.length === 0
        ? 'Ik kon hier niets uit halen. Controleer de spelling of voeg regels één voor één toe.'
        : `${preview.items.length} regel(s) gevonden. Controleer ze en bevestig om ze toe te voegen.`,
    };
  });

  /** Zet een bevestigde preview op een lijst. */
  api.post('/lists/:id/import', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    const body = z
      .object({
        items: z.array(
          z.object({
            name: z.string().min(1).max(200),
            amount: z.number().positive().optional(),
            unit: z.string().min(1).max(20).optional(),
            productId: z.string().nullable().optional(),
            inPantry: z.boolean().optional(),
          }),
        ),
      })
      .safeParse(request.body ?? {});

    if (!body.success) return reply.status(400).send({ error: 'Ongeldige aanvraag', details: body.error.flatten() });

    const { makeQuantity } = await import('@boodschappen/core');
    const created = app.shopping.commit(
      id,
      body.data.items.map((item) => ({
        name: item.name,
        ...(item.amount && item.unit ? { quantity: makeQuantity(item.amount, item.unit) } : {}),
        productId: item.productId ?? null,
        inPantry: item.inPantry ?? false,
      })),
    );

    return reply.status(201).send({ added: created.length, items: created });
  });

  /** Optimale winkelsamenstelling voor een lijst. */
  api.get('/lists/:id/optimize', async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    // `stores` is een queryparameter, geen pathparameter; anders zou de
    // winkelkeuze in de frontend stil worden genegeerd.
    const query = z
      .object({
        stores: z
          .string()
          .optional()
          .transform((value) =>
            value === undefined
              ? undefined
              : value
                  .split(',')
                  .map((store) => store.trim())
                  .filter((store): store is (typeof STORE_IDS)[number] =>
                    (STORE_IDS as readonly string[]).includes(store),
                  ),
          ),
      })
      .parse(request.query ?? {});

    const allowedStores = query.stores && query.stores.length > 0 ? query.stores : undefined;

    const result = app.shopping.optimizeList(params.id, allowedStores ? { allowedStores } : {});
    return {
      ...result,
      message: result.totalPricedItems === 0
        ? 'Er zijn nog geen prijzen beschikbaar. Koppel een databron of voer prijzen zelf in.'
        : result.hasCompletePricing
          ? 'Totaal is compleet: elk product heeft een prijs.'
          : `${result.totalUnpricedItems} product(en) hebben geen prijs. Het totaal is dus niet compleet.`,
    };
  });

  // ---------------------------------------------------------------------------
  // Voorraadkast
  // ---------------------------------------------------------------------------

  api.get('/pantry', async () => ({ items: app.pantry.list(userId(app)) }));

  api.post('/pantry', async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(200),
        amount: z.number().positive().optional(),
        unit: z.string().min(1).max(20).optional(),
      })
      .safeParse(request.body ?? {});

    if (!body.success) return reply.status(400).send({ error: 'Ongeldige aanvraag', details: body.error.flatten() });

    const { makeQuantity } = await import('@boodschappen/core');
    return reply.status(201).send({
      item: app.pantry.add(userId(app), {
        name: body.data.name,
        ...(body.data.amount && body.data.unit ? { quantity: makeQuantity(body.data.amount, body.data.unit) } : {}),
      }),
    });
  });

  api.delete('/pantry/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    app.pantry.remove(id);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Weekmenu
  // ---------------------------------------------------------------------------

  api.get('/menu', async (request) => {
    const query = z.object({ date: z.string().optional() }).parse(request.query ?? {});
    return { menu: app.menu.week(userId(app), query.date) };
  });

  api.post('/menu/meals', async (request, reply) => {
    const body = z
      .object({
        day: z.string().min(1),
        name: z.string().min(1).max(200),
        note: z.string().max(500).nullable().optional(),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              amount: z.number().positive().optional(),
              unit: z.string().min(1).max(20).optional(),
              inPantry: z.boolean().optional(),
            }),
          )
          .optional(),
      })
      .safeParse(request.body ?? {});

    if (!body.success) return reply.status(400).send({ error: 'Ongeldige aanvraag', details: body.error.flatten() });

    const { makeQuantity } = await import('@boodschappen/core');
    try {
      return reply.status(201).send({
        menu: app.menu.addMeal(userId(app), {
          day: body.data.day,
          name: body.data.name,
          note: body.data.note ?? null,
          ingredients: (body.data.ingredients ?? []).map((ingredient) => ({
            name: ingredient.name,
            ...(ingredient.amount && ingredient.unit ? { quantity: makeQuantity(ingredient.amount, ingredient.unit) } : {}),
            inPantry: ingredient.inPantry ?? false,
          })),
        }),
      });
    } catch (error) {
      return reply.status(400).send({ error: String(error instanceof Error ? error.message : error) });
    }
  });

  api.delete('/menu/meals/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    app.menu.deleteMeal(id);
    return reply.status(204).send();
  });

  /** Wat heb je vandaag nodig? */
  api.get('/today', async () => app.menu.todayNeeded(userId(app)));

  // ---------------------------------------------------------------------------
  // Producten
  // ---------------------------------------------------------------------------

  api.get('/products', async () => {
    const rows = app.db.select().from(app.db._.fullSchema.products).all();
    return {
      products: rows.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        verified: row.verified,
        source: row.source,
      })),
      unverified: app.sync.products.unverifiedProducts().length,
    };
  });

  api.post('/products/:id/confirm', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    app.sync.products.confirm(id);
    return { product: { id, verified: true } };
  });

  api.post('/products/:id/alias', async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params ?? {});
    const body = z.object({ alias: z.string().min(1).max(200) }).parse(request.body ?? {});
    app.sync.products.addAlias(id, body.alias);
    return { ok: true, productId: id, alias: body.alias };
  });
};
}
