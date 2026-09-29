/**
 * Boodschappenlijsten.
 *
 * Deze service verbindt de database met de domeinlogica uit @boodschappen/core:
 * parser, eenheden, productnormalisatie, prijsberekening en optimalisatie.
 *
 * De service doet drie dingen:
 *  1. Lijsten en regels beheren (opslaan, afvinken, verwijderen).
 *  2. Vrije tekst uitlezen met de parser, inclusief een preview die de
 *     gebruiker kan nakijken voordat er iets wordt opgeslagen.
 *  3. Prijzen en winkelsamenstellingen berekenen uit de opgeslagen aanbiedingen.
 *
 * Belangrijk: een regel zonder prijsinformatie blijft zichtbaar en wordt niet
 * stilzwijgend geschat. Het totaal is pas betrouwbaar als `unpriced` leeg is;
 * dat staat in het antwoord als `hasCompletePricing`.
 */

import {
  type ItemQuote,
  type OptimizableItem,
  type OfferConditions,
  type OfferKind,
  type OptimizationResult,
  type BulkParseResult,
  type MatchVerdict,
  type PriceQuote,
  type Quantity,
  type StoreId,
  type UnitDimension,
  computeQuote,
  makeQuantity,
  normalizeName,
  matchProduct,
  optimize,
  parseBulkText,
} from '@boodschappen/core';
import { type Database_ } from '../db/client.js';
import { offers, pantryItems, prices, products, shoppingItems, shoppingLists, storeProducts } from '../db/schema.js';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ProductResolver } from './products.js';

export interface ListRow {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  checkedCount: number;
}

export interface ItemRow {
  id: string;
  listId: string;
  name: string;
  normalizedName: string;
  dimension: UnitDimension;
  amount: number;
  unit: string;
  checked: boolean;
  inPantry: boolean;
  note: string | null;
  origin: string;
  productId: string | null;
  sortOrder: number;
}

export interface ItemDetail extends ItemRow {
  quotes: Array<{
    storeId: string;
    storeName: string;
    quote: PriceQuote;
  }>;
  best: { storeId: string; storeName: string; quote: PriceQuote } | null;
  /** Winkel met de laagste eenheidsprijs, ongeacht acties of voorwaarden. */
  cheapestRegular: { storeId: string; storeName: string; price: number } | null;
}

export interface PreviewRow {
  name: string;
  normalizedName: string;
  quantity: Quantity;
  /** Product uit de database waar dit aan lijkt te komen, indien gevonden. */
  suggestedProductId: string | null;
  suggestedProductName: string | null;
  confidence: number | null;
  needsConfirmation: boolean;
  candidates: Array<{ productId: string; name: string; confidence: number }>;
  inPantry: boolean;
  pantryAmount: number | null;
}

const toQuantity = (dimension: UnitDimension, amount: number, unit: string): Quantity =>
  makeQuantity(amount, unit);

export class ShoppingService {
  /**
   * @param products De productzoeker. Die is nodig zodat ook hier de synoniemen
   *   van de gebruiker meetellen: iemand die "cola" aan "Coca-Cola regular" heeft
   *   gekoppeld, wil dat overal zo werken, niet alleen bij het ophalen van prijzen.
   */
  constructor(
    private readonly db: Database_,
    private readonly products?: ProductResolver,
  ) {}

  // -------------------------------------------------------------------------
  // Lijsten
  // -------------------------------------------------------------------------

  createList(userId: string | null, name = 'Mijn boodschappen'): ListRow {
    const id = randomUUID();
    this.db.insert(shoppingLists).values({ id, userId, name }).run();
    return this.list(id)!;
  }

  list(id: string): ListRow | null {
    const row = this.db.select().from(shoppingLists).where(eq(shoppingLists.id, id)).get();
    if (!row) return null;
    const counts = this.db
      .select({
        itemCount: sql<number>`count(*)`,
        checkedCount: sql<number>`coalesce(sum(case when ${shoppingItems.checked} = 1 then 1 else 0 end), 0)`,
      })
      .from(shoppingItems)
      .where(eq(shoppingItems.listId, id))
      .get();

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      itemCount: counts?.itemCount ?? 0,
      checkedCount: counts?.checkedCount ?? 0,
    };
  }

  lists(userId: string | null): ListRow[] {
    const rows =
      userId === null
        ? this.db.select().from(shoppingLists).all()
        : this.db.select().from(shoppingLists).where(eq(shoppingLists.userId, userId)).all();
    return rows.map((row) => this.list(row.id)!).filter(Boolean);
  }

  renameList(id: string, name: string): ListRow | null {
    this.db
      .update(shoppingLists)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(shoppingLists.id, id))
      .run();
    return this.list(id);
  }

  deleteList(id: string): void {
    this.db.delete(shoppingLists).where(eq(shoppingLists.id, id)).run();
  }

  // -------------------------------------------------------------------------
  // Regels
  // -------------------------------------------------------------------------

  items(listId: string): ItemRow[] {
    return this.db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.listId, listId))
      .orderBy(asc(shoppingItems.sortOrder), asc(shoppingItems.createdAt))
      .all()
      .map((row) => this.toRow(row));
  }

  private toRow(row: typeof shoppingItems.$inferSelect): ItemRow {
    return {
      id: row.id,
      listId: row.listId,
      name: row.name,
      normalizedName: row.normalizedName,
      dimension: row.dimension,
      amount: row.amount,
      unit: row.unit,
      checked: row.checked,
      inPantry: row.inPantry,
      note: row.note,
      origin: row.origin,
      productId: row.productId,
      sortOrder: row.sortOrder,
    };
  }

  addItem(listId: string, input: { name: string; quantity?: Quantity; note?: string | null; productId?: string | null; inPantry?: boolean }): ItemRow {
    const id = randomUUID();
    const quantity = input.quantity ?? makeQuantity(1, 'st');
    const normalized = normalizeName(input.name);
    // Zonder uitdrukkelijke koppeling zoeken we zelf naar een product, maar
    // alleen als de match zeker is (kern drempel 0,92 inclusief variantcheck).
    // Zo blijft "melk" aan "Melk" hangen, terwijl "cola" los blijft staan.
    const productId = input.productId ?? this.confidentProductId(input.name);
    const nextOrder =
      (this.db.select({ n: sql<number>`coalesce(max(${shoppingItems.sortOrder}), 0)` }).from(shoppingItems).where(eq(shoppingItems.listId, listId)).get()?.n ?? 0) + 1;

    this.db
      .insert(shoppingItems)
      .values({
        id,
        listId,
        productId,
        name: input.name.trim(),
        normalizedName: normalized,
        dimension: quantity.dimension,
        amount: quantity.amount,
        unit: quantity.unit,
        note: input.note ?? null,
        inPantry: input.inPantry ?? false,
        origin: 'manual',
        sortOrder: nextOrder,
      })
      .run();
    this.touch(listId);
    return this.item(id)!;
  }

  /** Alleen bij een zekere match een product koppelen; anders blijft het leeg. */
  private confidentProductId(name: string): string | null {
    const verdict = this.findProduct(name);
    return verdict.kind === 'match' ? verdict.product.productId : null;
  }

  item(id: string): ItemRow | null {
    const row = this.db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get();
    return row ? this.toRow(row) : null;
  }

  updateItem(id: string, patch: { name?: string; amount?: number; unit?: string; dimension?: UnitDimension; checked?: boolean; inPantry?: boolean; note?: string | null; productId?: string | null }): ItemRow | null {
    const current = this.item(id);
    if (!current) return null;

    this.db
      .update(shoppingItems)
      .set({
        name: patch.name ?? current.name,
        normalizedName: patch.name ? normalizeName(patch.name) : current.normalizedName,
        amount: patch.amount ?? current.amount,
        unit: patch.unit ?? current.unit,
        dimension: patch.dimension ?? current.dimension,
        checked: patch.checked ?? current.checked,
        inPantry: patch.inPantry ?? current.inPantry,
        note: patch.note === undefined ? current.note : patch.note,
        productId: patch.productId === undefined ? current.productId : patch.productId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(shoppingItems.id, id))
      .run();
    // Een handmatig gekozen koppeling onthouden we als synonieem, zodat de
    // volgende keer dat "melk" vanzelf hetzelfde product wordt. Anders moet de
    // gebruiker elke keer opnieuw kiezen.
    if (patch.productId && patch.productId !== current.productId && this.products) {
      this.products.addAlias(patch.productId, current.name);
    }
    this.touch(current.listId);
    return this.item(id);
  }

  deleteItem(id: string): void {
    const current = this.item(id);
    this.db.delete(shoppingItems).where(eq(shoppingItems.id, id)).run();
    if (current) this.touch(current.listId);
  }

  private touch(listId: string): void {
    this.db
      .update(shoppingLists)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(shoppingLists.id, listId))
      .run();
  }

  // -------------------------------------------------------------------------
  // Parser
  // -------------------------------------------------------------------------

  /**
   * Leest losse tekst en zet hem meteen in de lijst, zonder tussenstap.
   *
   * Dit is wat de app gebruikt als je "melk" of "melk, cola, blikjes" typt.
   * De herkenning doet hetzelfde als altijd, maar je hoeft niets te bevestigen:
   * wat zeker is wordt gekoppeld, wat onzeker is komt als gewone regel in de
   * lijst. De voorgestelde producten komen terug zodat de app er later nog een
   * koppeling kan aanbieden.
   */
  addText(listId: string, text: string, userId: string | null): { items: ItemRow[]; suggestions: Array<{ itemId: string; name: string; candidates: Array<{ productId: string; name: string; confidence: number }> }> } {
    const { items: parsed } = this.preview(text, userId);
    const created = this.commit(
      listId,
      parsed.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        // Alleen een zekere match wordt meegestuurd; anders blijft de regel
        // een gewone lijstregel zonder product, precies zoals bij handmatig
        // toevoegen.
        productId: item.suggestedProductId,
        inPantry: item.inPantry,
      })),
    );

    const suggestions = parsed
      .map((item, index) => ({
        itemId: created[index]?.id,
        name: item.name,
        candidates: item.candidates,
      }))
      .filter((entry): entry is { itemId: string; name: string; candidates: Array<{ productId: string; name: string; confidence: number }> } =>
        Boolean(entry.itemId) && entry.candidates.length > 0,
      );

    return { items: created, suggestions };
  }

  /**
   * Leest vrije tekst uit, bijvoorbeeld:
   *   "2 melk\n1,5 l cola zero\n3 x pakken yoghurt van 500g"
   * Geeft een preview terug zodat de gebruiker alles kan nakijken en bevestigen.
   */
  preview(text: string, userId: string | null): { items: PreviewRow[]; raw: BulkParseResult } {
    const parsed = parseBulkText(text);
    const pantry = this.pantryLookup(userId);

    const items: PreviewRow[] = parsed.items.map((item) => {
      const key = normalizeName(item.name);
      const verdict = this.findProduct(item.name);
      const pantryAmount = pantry.get(key) ?? null;
      const suggestion = verdict.kind === 'match' ? verdict.product : null;

      return {
        name: item.name,
        normalizedName: key,
        quantity: item.quantity,
        suggestedProductId: suggestion?.productId ?? null,
        suggestedProductName: suggestion?.name ?? null,
        confidence: suggestion?.confidence ?? null,
        // Bij twijfel vraagt de app om bevestiging in plaats van te gokken.
        needsConfirmation: verdict.kind !== 'match' || item.confidence < 0.9,
        candidates: (verdict.kind === 'match' ? [] : verdict.candidates).map((c) => ({
          productId: c.productId,
          name: c.name,
          confidence: c.confidence,
        })),
        inPantry: pantryAmount !== null,
        pantryAmount,
      };
    });

    return { items, raw: parsed };
  }

  /** Zet een bevestigde preview om in echte lijstregels. */
  commit(listId: string, entries: Array<{ name: string; quantity?: Quantity; productId?: string | null; inPantry?: boolean }>): ItemRow[] {
    const created: ItemRow[] = [];
    for (const entry of entries) {
      created.push(this.addItem(listId, entry));
    }
    return created;
  }

  private pantryLookup(userId: string | null): Map<string, number> {
    const rows =
      userId === null
        ? this.db.select().from(pantryItems).all()
        : this.db.select().from(pantryItems).where(eq(pantryItems.userId, userId)).all();
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.normalizedName, row.amount);
    return map;
  }

  private findProduct(name: string): MatchVerdict {
    // Met de productzoeker erbij, zodat eigen synoniemen en bevestigde
    // koppelingen hier ook gelden.
    if (this.products) return this.products.match(name);
    const candidates = this.db
      .select({ id: products.id, name: products.name })
      .from(products)
      .all()
      .map((row) => ({ id: row.id, name: row.name }));
    return matchProduct(name, candidates);
  }

  // -------------------------------------------------------------------------
  // Prijzen en winkelsamenstelling
  // -------------------------------------------------------------------------

  /**
   * Berekent voor elke regel de beschikbare prijzen, met acties, voorwaarden
   * en eenheidsprijs. Producten zonder prijsinformatie blijven zichtbaar.
   */
  details(listId: string): ItemDetail[] {
    const items = this.items(listId);
    return items.map((item) => {
      const quotes = item.productId ? this.quotesFor(item.productId, item) : [];
      const priced = quotes.filter((q) => q.quote.basketCost > 0);
      const best = priced.length > 0 ? priced.reduce((a, b) => (b.quote.basketCost < a.quote.basketCost ? b : a)) : null;
      const cheapestRegular = priced.length
        ? (() => {
            const best = priced.reduce((a, b) => (b.quote.unitPrice < a.quote.unitPrice ? b : a));
            return { storeId: best.storeId, storeName: best.storeName, price: best.quote.unitPrice };
          })()
        : null;
      return { ...item, quotes, best, cheapestRegular };
    });
  }

  /** Alle aanbiedingen en prijzen voor één product, berekend per winkel. */
  private quotesFor(productId: string, item: ItemRow): ItemDetail['quotes'] {
    const requiredQuantity = toQuantity(item.dimension, item.amount, item.unit);

    const rows = this.db
      .select({
        offer: offers,
        storeName: storeProducts.storeName,
        packDescription: storeProducts.packDescription,
        price: prices,
      })
      .from(offers)
      .innerJoin(storeProducts, eq(storeProducts.id, offers.storeProductId))
      .leftJoin(prices, and(eq(prices.storeProductId, offers.storeProductId), eq(prices.storeId, offers.storeId)))
      .where(and(eq(offers.productId, productId), eq(offers.storeId, offers.storeId)))
      .all();

    const byStore = new Map<string, ItemDetail['quotes'][number]>();

    for (const row of rows) {
      const conditions = (row.offer.conditions ?? {}) as OfferConditions;
      const kind = row.offer.kind as OfferKind;
      const regularPrice = centsToPrice(row.price?.regularPriceCents ?? row.offer.regularPriceCents);
      const offerPrice = centsToPrice(row.price?.offerPriceCents ?? row.offer.offerPriceCents);

      // Zonder normale prijs én zonder actieprijs is er niets te vergelijken.
      if (regularPrice === null && offerPrice === null) continue;

      const quote = computeQuote({
        storeId: row.offer.storeId,
        regularPrice,
        offerPrice,
        kind,
        conditions,
        packQuantity: row.price?.packQuantity ? { dimension: 'volume', amount: row.price.packQuantity, unit: row.price.packUnit ?? 'l' } as unknown as Quantity : null,
        requiredQuantity,
        productName: item.name,
        inStock: row.price?.inStock ?? true,
      });

      const existing = byStore.get(row.offer.storeId);
      // Meerdere aanbiedingen per winkel: houd de goedkoopste.
      if (!existing || quote.basketCost < existing.quote.basketCost) {
        byStore.set(row.offer.storeId, {
          storeId: row.offer.storeId,
          storeName: row.offer.storeName,
          quote,
        });
      }
    }

    return [...byStore.values()].sort((a, b) => a.quote.basketCost - b.quote.basketCost);
  }

  /** Optimale winkelsamenstelling voor de huidige lijst. */
  optimizeList(listId: string, options: { allowedStores?: StoreId[] } = {}): OptimizationResult {
    const details = this.details(listId);
    const items: OptimizableItem[] = details.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: toQuantity(item.dimension, item.amount, item.unit),
      checked: item.checked,
      inPantry: item.inPantry,
    }));

    const quotes: ItemQuote[] = [];
    for (const item of details) {
      for (const entry of item.quotes) {
        if (options.allowedStores && !options.allowedStores.includes(entry.storeId as StoreId)) continue;
        quotes.push({
          itemId: item.id,
          itemName: item.name,
          quantity: toQuantity(item.dimension, item.amount, item.unit),
          storeId: entry.storeId,
          quote: entry.quote,
        });
      }
    }

    return optimize(items, quotes, {});
  }
}

function centsToPrice(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}
