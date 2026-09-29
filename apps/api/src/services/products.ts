/**
 * Productidentificatie.
 *
 * Een winkel noemt een product anders dan jij: "Coca-Cola regular 1,5L" tegen
 * jouw "cola". Deze service koppelt de winkelnaam aan een intern product via:
 *  1. GTIN/barcode als die bekend is (betrouwbaarst);
 *  2. de matchlogica uit @boodschappen/core, die bewust terughoudend is;
 *  3. anders blijft het product onbekend en wordt het als "nog niet herkend"
 *     opgeslagen, zodat de gebruiker het zelf kan koppelen.
 *
 * Er wordt nooit stilzwijgend een verkeerd product gekoppeld.
 */

import {
  type MatchableProduct,
  type MatchVerdict,
  type ProductCategory,
  buildSynonymIndex,
  canonicalName,
  inferCategory,
  matchProduct,
  normalizeName,
  type SynonymIndex,
} from '@boodschappen/core';
import { type Database_ } from '../db/client.js';
import { productAliases, products, storeProducts } from '../db/schema.js';
import { and, eq, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export interface ResolveInput {
  name: string;
  gtin?: string | null;
  storeId: string;
  storeProductId: string;
  packDescription?: string | null;
}

export interface ResolvedProduct {
  productId: string;
  created: boolean;
  matchedBy: 'gtin' | 'naam' | 'nieuw';
  confidence: number | null;
}

export class ProductResolver {
  private index: SynonymIndex = buildSynonymIndex();

  constructor(private readonly db: Database_) {
    this.reload();
  }

  /**
   * Herlaadt de gebruikerssynoniemen uit de database.
   *
   * De index verwacht `canonieke naam -> aliassen`, dus hier groeperen we de
   * aliassen per product. De productnaam zelf is de canonieke naam.
   */
  reload(): void {
    const rows = this.db
      .select({
        productId: productAliases.productId,
        alias: productAliases.normalizedAlias,
        name: products.name,
      })
      .from(productAliases)
      .innerJoin(products, eq(products.id, productAliases.productId))
      .all();

    // De index verwacht `canonieke naam -> aliassen`, dus hier groeperen we de
    // aliassen per product. De productnaam zelf is de canonieke naam.
    const byProduct = new Map<string, Set<string>>();
    for (const row of rows) {
      const aliases = byProduct.get(row.productId) ?? new Set<string>();
      aliases.add(row.alias);
      byProduct.set(row.productId, aliases);
    }

    const canonicalByProduct = new Map<string, string>();
    for (const row of rows) canonicalByProduct.set(row.productId, normalizeName(row.name));

    const userSynonyms = new Map<string, readonly string[]>();
    for (const [productId, aliases] of byProduct) {
      const canonical = canonicalByProduct.get(productId);
      if (!canonical) continue;
      // De eigen naam is geen alias van zichzelf.
      userSynonyms.set(
        canonical,
        [...aliases].filter((alias) => alias !== canonical),
      );
    }

    this.index = buildSynonymIndex(userSynonyms);
  }

  private candidates(): MatchableProduct[] {
    return this.db
      .select({ id: products.id, name: products.name, category: products.category })
      .from(products)
      .all()
      .map((row) => ({ id: row.id, name: row.name, category: row.category as ProductCategory | null }));
  }

  /**
   * Zoekt een product bij een naam, met de eigen synoniemen van de gebruiker
   * erbij. Alle plekken die een naam aan een product willen koppelen lopen via
   * hier, zodat een bevestigde koppeling overal hetzelfde uitpakt.
   */
  match(name: string): MatchVerdict {
    return matchProduct(name, this.candidates(), this.index);
  }

  /** Zoekt of maakt het product waar een winkelartikel naar verwijst. */
  resolve(input: ResolveInput): ResolvedProduct {
    const existingLink = this.db
      .select({
        productId: storeProducts.productId,
        name: products.name,
      })
      .from(storeProducts)
      .innerJoin(products, eq(products.id, storeProducts.productId))
      .where(and(eq(storeProducts.storeId, input.storeId), eq(storeProducts.storeProductId, input.storeProductId)))
      .get();

    if (existingLink) {
      return { productId: existingLink.productId, created: false, matchedBy: 'gtin', confidence: 1 };
    }

    // 1. GTIN: exact op barcode, als die bekend is.
    if (input.gtin) {
      const byGtin = this.db.select({ id: products.id }).from(products).where(eq(products.gtin, input.gtin)).get();
      if (byGtin) {
        this.link(input, byGtin.id);
        return { productId: byGtin.id, created: false, matchedBy: 'gtin', confidence: 1 };
      }
    }

    // 2. Naam.
    const verdict: MatchVerdict = matchProduct(input.name, this.candidates(), this.index);

    if (verdict.kind === 'match') {
      this.link(input, verdict.product.productId);
      if (input.gtin) this.setGtin(verdict.product.productId, input.gtin);
      return { productId: verdict.product.productId, created: false, matchedBy: 'naam', confidence: verdict.product.confidence };
    }

    // 3. Nieuw product aanmaken. Bij twijfel (suggest) slaan we het op als
    //    onzeker, zodat de gebruiker het later kan bevestigen.
    const productId = this.create(input, verdict.kind === 'suggest');
    this.link(input, productId);
    if (input.gtin) this.setGtin(productId, input.gtin);
    return { productId, created: true, matchedBy: 'nieuw', confidence: null };
  }

  private link(input: ResolveInput, productId: string): void {
    const existing = this.db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(and(eq(storeProducts.storeId, input.storeId), eq(storeProducts.storeProductId, input.storeProductId)))
      .get();
    if (existing) {
      this.db.update(storeProducts).set({ productId, updatedAt: new Date().toISOString() }).where(eq(storeProducts.id, existing.id)).run();
      return;
    }
    this.db
      .insert(storeProducts)
      .values({
        id: randomUUID(),
        storeId: input.storeId,
        productId,
        storeProductId: input.storeProductId,
        gtin: input.gtin ?? null,
        storeName: input.name,
        packDescription: input.packDescription ?? null,
        lastSeenAt: new Date().toISOString(),
      })
      .run();
  }

  private create(input: ResolveInput, needsReview: boolean): string {
    const id = randomUUID();
    const normalized = normalizeName(input.name);
    this.db
      .insert(products)
      .values({
        id,
        name: input.name,
        normalizedName: normalized,
        canonicalName: canonicalName(input.name, this.index),
        category: inferCategory(input.name, this.index),
        gtin: input.gtin ?? null,
        source: needsReview ? 'onbekend' : 'databron',
        // `verified` blijft onwaar zolang de gebruiker het niet heeft bevestigd.
        verified: false,
      })
      .run();
    // De eigen naam wordt een alias, maar alleen als die nog niet bestaat:
    // een bestaande alias hoort bij een ander product en blijft daar.
    this.db
      .insert(productAliases)
      .values({ id: randomUUID(), productId: id, alias: input.name, normalizedAlias: normalized })
      .onConflictDoNothing()
      .run();
    return id;
  }

  private setGtin(productId: string, gtin: string): void {
    this.db.update(products).set({ gtin, updatedAt: new Date().toISOString() }).where(eq(products.id, productId)).run();
  }

  /** Producten die de gebruiker nog moet bevestigen. */
  unverifiedProducts(): Array<{ id: string; name: string; category: string | null }> {
    return this.db
      .select({ id: products.id, name: products.name, category: products.category })
      .from(products)
      .where(eq(products.verified, false))
      .all();
  }

  confirm(productId: string): void {
    this.db
      .update(products)
      .set({ verified: true, source: 'bevestigd', updatedAt: new Date().toISOString() })
      .where(eq(products.id, productId))
      .run();
  }

  /** Voegt een eigen synoniem toe (bv. "sodaboter" -> "margarine"). */
  addAlias(productId: string, alias: string): void {
    const normalized = normalizeName(alias);
    if (!normalized) return;
    const existing = this.db
      .select({ id: productAliases.id })
      .from(productAliases)
      .where(or(eq(productAliases.normalizedAlias, normalized), and(eq(productAliases.productId, productId), eq(productAliases.alias, alias))))
      .get();
    if (existing) return;
    this.db
      .insert(productAliases)
      .values({ id: randomUUID(), productId, alias, normalizedAlias: normalized })
      .onConflictDoNothing()
      .run();
    this.reload();
  }

  count(): number {
    return this.db.select({ n: sql<number>`count(*)` }).from(products).get()?.n ?? 0;
  }
}
