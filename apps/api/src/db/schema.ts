/**
 * Databaseschema.
 *
 * Ontwerpkeuzes:
 *  - SQLite via drizzle-orm, zodat de app zonder installatie werkt. Het schema
 *    is geschreven in portable SQL en kan zonder codewijziging naar PostgreSQL
 *    (Neon/Supabase) of MySQL (PlanetScale) verplaatst worden.
 *  - Prijzen, aanbiedingen en prijsgeschiedenis zijn van elkaar gescheiden, zodat
 *    later meerdere databronnen per winkel ondersteund kunnen worden zonder het
 *    historische archief te raken.
 *  - `store_products` koppelt een product aan de GTIN per winkel, omdat
 *   Albert Heijn, Lidl, Dirk en Kruidvat hetzelfde artikel met verschillende
 *    barcode nummeren verkopen.
 *  - Overal staan tijdstempels (created_at/updated_at) voor cache- en
 *    synchronisatiedoeleinden.
 */

import { type InferInsertModel, type InferSelectModel, sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Alleen een weergavenaam; er is geen wachtwoord of authenticatie in deze versie. */
    displayName: text('display_name').notNull().default('Gebruiker'),
    email: text('email'),
    locale: text('locale').notNull().default('nl'),
    timezone: text('timezone').notNull().default('Europe/Amsterdam'),
    settings: text('settings', { mode: 'json' })
      .$type<{
        optimization?: 'cheapest' | 'minimal_stores';
        includeCardOnlyDeals?: boolean;
        priceDecimals?: number;
        offerCacheSeconds?: number;
        showUnpricedInTotals?: boolean;
        autoMarkPantryAsInHouse?: boolean;
      }>()
      .notNull()
      .default({} as never),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({ emailIdx: uniqueIndex('users_email_idx').on(table.email) }),
);

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

// ---------------------------------------------------------------------------
// stores
// ---------------------------------------------------------------------------

export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(), // 'lidl' | 'albert_heijn' | 'dirk' | 'kruidvat'
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    website: text('website'),
    /** Naam van de adapter die deze winkel bedient. */
    adapter: text('adapter').notNull(),
    /** Basismunt. */
    currency: text('currency').notNull().default('EUR'),
    /** Naam van de bonuskaart, bv. 'AH Bonuskaart'. */
    loyaltyCardName: text('loyalty_card_name'),
    color: text('color').notNull().default('#0a5ca8'),
    displayOrder: integer('display_order').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => ({ orderIdx: index('stores_order_idx').on(table.displayOrder) }),
);

export type Store = InferSelectModel<typeof stores>;

// ---------------------------------------------------------------------------
// data_sources — per winkel en per bron de status van de koppeling
// ---------------------------------------------------------------------------

export const dataSources = sqliteTable(
  'data_sources',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    /** Technische naam van de bron, bv. 'licensed-aggregator'. */
    provider: text('provider').notNull(),
    /** Door de gebruiker gegeven herkenning van de bron. */
    label: text('label').notNull(),
    status: text('status', {
      // 'network_disabled' is geen fout maar een bewuste keuze: het netwerk
      // staat uit. De databasekolom heeft daarom geen CHECK-beperking.
      enum: ['connected', 'not_configured', 'network_disabled', 'error', 'rate_limited', 'syncing'],
    })
      .notNull()
      .default('not_configured'),
    /** Optionele officiële documentatielink. */
    documentationUrl: text('documentation_url'),
    lastAttemptAt: text('last_attempt_at'),
    lastSuccessAt: text('last_success_at'),
    lastError: text('last_error'),
    offersImported: integer('offers_imported').notNull().default(0),
    pricesImported: integer('prices_imported').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({
    storeIdx: index('data_sources_store_idx').on(table.storeId),
    providerIdx: uniqueIndex('data_sources_provider_store_idx').on(table.provider, table.storeId),
  }),
);

export type DataSource = InferSelectModel<typeof dataSources>;

// ---------------------------------------------------------------------------
// products — het productcatalogus
// ---------------------------------------------------------------------------

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    /** Weergavenaam, bv. 'Coca-Cola'. */
    name: text('name').notNull(),
    /** Genormaliseerde naam voor matching. */
    normalizedName: text('normalized_name').notNull(),
    /** Canonieke naam volgens het synoniemenboek. */
    canonicalName: text('canonical_name').notNull(),
    brand: text('brand'),
    category: text('category', {
      enum: [
        'groente', 'fruit', 'zuivel', 'vlees', 'vis', 'brood',
        'voorradskast', 'snacks', 'drank', 'dieet', 'huishouden', 'overig',
      ],
    })
      .notNull()
      .default('overig'),
    drinkKind: text('drink_kind', {
      enum: ['frisdrank', 'water', 'sap', 'energie', 'bier', 'wijn', 'sterkedrank', 'koffie-thee', 'overig'],
    }),
    /** Eenheid van de productmaat, bv. 'l' of 'kg'. */
    unit: text('unit'),
    unitDimension: text('unit_dimension', { enum: ['mass', 'volume', 'count', 'packaging'] }),
    /** Inhoud/gewicht van één verpakking, in basiseenheden (ml/g/st). */
    unitAmount: real('unit_amount'),
    /** Mensenleesbare maat, bv. '1,5 l'. */
    quantityHint: text('quantity_hint'),
    /** EAN/GTIN. */
    gtin: text('gtin'),
    /** Waar dit product oorspronkelijk vandaan komt. */
    source: text('source').notNull().default('handmatig'),
    /** Of de gebruiker dit product heeft bevestigd. */
    verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({
    normalizedIdx: index('products_normalized_idx').on(table.normalizedName),
    canonicalIdx: index('products_canonical_idx').on(table.canonicalName),
    categoryIdx: index('products_category_idx').on(table.category),
    drinkIdx: index('products_drink_kind_idx').on(table.drinkKind),
    gtinIdx: index('products_gtin_idx').on(table.gtin),
  }),
);

export type Product = InferSelectModel<typeof products>;
export type NewProduct = InferInsertModel<typeof products>;

/** Door de gebruiker bevestigde synoniemen (leert de herkenning). */
export const productAliases = sqliteTable(
  'product_aliases',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    normalizedAlias: text('normalized_alias').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => ({
    aliasIdx: uniqueIndex('product_aliases_alias_idx').on(table.normalizedAlias),
    productIdx: index('product_aliases_product_idx').on(table.productId),
  }),
);

export type ProductAlias = InferSelectModel<typeof productAliases>;

/** Koppelt een product aan de artikel-id van een specifieke winkel. */
export const storeProducts = sqliteTable(
  'store_products',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Artikel-id binnen de winkel. */
    storeProductId: text('store_product_id').notNull(),
    gtin: text('gtin'),
    storeName: text('store_name').notNull(),
    packDescription: text('pack_description'),
    productUrl: text('product_url'),
    lastSeenAt: text('last_seen_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({
    storeProductIdx: uniqueIndex('store_products_store_item_idx').on(table.storeId, table.storeProductId),
    productIdx: index('store_products_product_idx').on(table.productId),
    gtinIdx: index('store_products_gtin_idx').on(table.gtin),
  }),
);

export type StoreProduct = InferSelectModel<typeof storeProducts>;

// ---------------------------------------------------------------------------
// prices — actuele prijs per product per winkel
// ---------------------------------------------------------------------------

export const prices = sqliteTable(
  'prices',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    storeProductId: text('store_product_id')
      .notNull()
      .references(() => storeProducts.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Prijs per verpakking, in centen. Integers voorkomen afrondingsfouten. */
    regularPriceCents: integer('regular_price_cents'),
    /** Actieprijs per verpakking, in centen. */
    offerPriceCents: integer('offer_price_cents'),
    /** Korting in procenten, bv. 30. */
    discountPercent: real('discount_percent'),
    currency: text('currency').notNull().default('EUR'),
    inStock: integer('in_stock', { mode: 'boolean' }).notNull().default(true),
    /** Eenheden per verpakking in basiseenheden; bv. 1500 voor 1,5 l. */
    packQuantity: real('pack_quantity'),
    packUnit: text('pack_unit'),
    observedAt: text('observed_at').notNull().default(now),
    sourceId: text('source_id').references(() => dataSources.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => ({
    storeProductIdx: uniqueIndex('prices_store_product_idx').on(table.storeProductId, table.storeId),
    productStoreIdx: index('prices_product_store_idx').on(table.productId, table.storeId),
    observedIdx: index('prices_observed_idx').on(table.observedAt),
  }),
);

export type Price = InferSelectModel<typeof prices>;

// ---------------------------------------------------------------------------
// offers — aanbiedingen inclusief voorwaarden
// ---------------------------------------------------------------------------

export const offers = sqliteTable(
  'offers',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    storeProductId: text('store_product_id')
      .notNull()
      .references(() => storeProducts.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind', {
      enum: [
        'price_drop', 'multipack', 'second_half', 'loyalty',
        'min_quantity', 'bundle', 'per_volume', 'cashback',
      ],
    })
      .notNull()
      .default('price_drop'),
    /** Machineleesbare voorwaarden: { bundleSize, bundlePrice, ... }. */
    conditions: text('conditions', { mode: 'json' }).$type<{
      bundleSize?: number;
      bundlePrice?: number;
      secondUnitDiscount?: number;
      minQuantity?: number;
      maxPerPerson?: number;
      requiresLoyaltyCard?: boolean;
      loyaltyCardName?: string;
      instantSavings?: number;
      giftValue?: number;
      discountPercent?: number;
    }>().notNull().default({} as never),
    /** Actieprijs per verpakking in centen. */
    offerPriceCents: integer('offer_price_cents'),
    /** Originele prijs per verpakking in centen. */
    regularPriceCents: integer('regular_price_cents'),
    currency: text('currency').notNull().default('EUR'),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    /** Naam van de winkel, voor weergave zonder extra join. */
    storeName: text('store_name').notNull(),
    /** Beschrijving van de verpakking, bv. '1,5 l fles'. */
    packDescription: text('pack_description'),
    sourceId: text('source_id').references(() => dataSources.id, { onDelete: 'set null' }),
    sourceName: text('source_name'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({
    productIdx: index('offers_product_idx').on(table.productId),
    storeIdx: index('offers_store_idx').on(table.storeId),
    validityIdx: index('offers_validity_idx').on(table.validFrom, table.validUntil),
    storeProductIdx: index('offers_store_product_idx').on(table.storeProductId),
  }),
);

export type Offer = InferSelectModel<typeof offers>;

// ---------------------------------------------------------------------------
// price_history — historie van elke waargenomen prijs
// ---------------------------------------------------------------------------

export const priceHistory = sqliteTable(
  'price_history',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    storeProductId: text('store_product_id')
      .notNull()
      .references(() => storeProducts.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    regularPriceCents: integer('regular_price_cents'),
    offerPriceCents: integer('offer_price_cents'),
    isOffer: integer('is_offer', { mode: 'boolean' }).notNull().default(false),
    currency: text('currency').notNull().default('EUR'),
    /** Dag waarop deze prijs gold. */
    priceDate: text('price_date').notNull(),
    sourceId: text('source_id').references(() => dataSources.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => ({
    productDateIdx: index('price_history_product_date_idx').on(table.productId, table.priceDate),
    storeDateIdx: index('price_history_store_date_idx').on(table.storeId, table.priceDate),
  }),
);

export type PriceHistory = InferSelectModel<typeof priceHistory>;

// ---------------------------------------------------------------------------
// shopping_lists + shopping_items
// ---------------------------------------------------------------------------

export const shoppingLists = sqliteTable(
  'shopping_lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull().default('Mijn boodschappen'),
    /** 'active' lijst is degene die de interface toont. */
    status: text('status', { enum: ['active', 'archived', 'template'] })
      .notNull()
      .default('active'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({ userIdx: index('shopping_lists_user_idx').on(table.userId) }),
);

export type ShoppingList = InferSelectModel<typeof shoppingLists>;

export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    /** Weergavenaam zoals de gebruiker die zelf heeft ingetypt. */
    name: text('name').notNull(),
    /** Genormaliseerde naam, voor het terugvinden van dubbelen. */
    normalizedName: text('normalized_name').notNull(),
    dimension: text('dimension', { enum: ['mass', 'volume', 'count', 'packaging'] }).notNull().default('count'),
    /** Hoeveelheid in basiseenheden (g/ml/st/verpakkingen). */
    amount: real('amount').notNull().default(1),
    /** Eenheid zoals de gebruiker die noemde. */
    unit: text('unit').notNull().default('st'),
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
    /** Al in huis: telt niet mee in de kostenberekening. */
    inPantry: integer('in_pantry', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    origin: text('origin', { enum: ['manual', 'menu', 'import'] })
      .notNull()
      .default('manual'),
    /** Verwijzing naar het weekmenu-item waar dit item uit voortkomt. */
    sourceIngredientId: text('source_ingredient_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({
    listIdx: index('shopping_items_list_idx').on(table.listId),
    normalizedIdx: index('shopping_items_normalized_idx').on(table.normalizedName),
    productIdx: index('shopping_items_product_idx').on(table.productId),
  }),
);

export type ShoppingItem = InferSelectModel<typeof shoppingItems>;
export type NewShoppingItem = InferInsertModel<typeof shoppingItems>;

// ---------------------------------------------------------------------------
// pantry — wat er al in huis is
// ---------------------------------------------------------------------------

export const pantryItems = sqliteTable(
  'pantry_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    dimension: text('dimension', { enum: ['mass', 'volume', 'count', 'packaging'] }).notNull().default('count'),
    amount: real('amount').notNull().default(1),
    unit: text('unit').notNull().default('st'),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => ({
    userIdx: index('pantry_items_user_idx').on(table.userId),
    normalizedIdx: index('pantry_items_normalized_idx').on(table.normalizedName),
  }),
);

export type PantryItem = InferSelectModel<typeof pantryItems>;

// ---------------------------------------------------------------------------
// weekly_menus + meals + ingredients
// ---------------------------------------------------------------------------

export const weeklyMenus = sqliteTable(
  'weekly_menus',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** ISO-datum van de maandag van deze week. */
    weekStart: text('week_start').notNull(),
    title: text('title'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({ weekIdx: uniqueIndex('weekly_menus_user_week_idx').on(table.userId, table.weekStart) }),
);

export type WeeklyMenu = InferSelectModel<typeof weeklyMenus>;

export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    menuId: text('menu_id')
      .notNull()
      .references(() => weeklyMenus.id, { onDelete: 'cascade' }),
    day: text('day', {
      enum: ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'],
    }).notNull(),
    name: text('name').notNull(),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({ menuIdx: index('meals_menu_idx').on(table.menuId) }),
);

export type Meal = InferSelectModel<typeof meals>;

export const ingredients = sqliteTable(
  'ingredients',
  {
    id: text('id').primaryKey(),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    dimension: text('dimension', { enum: ['mass', 'volume', 'count', 'packaging'] }).notNull().default('count'),
    amount: real('amount').notNull().default(1),
    unit: text('unit').notNull().default('st'),
    /** Dit staat al in huis en hoeft dus niet gekocht te worden. */
    inPantry: integer('in_pantry', { mode: 'boolean' }).notNull().default(false),
    /** Alleen meenemen als het niet in huis is. */
    onlyIfMissing: integer('only_if_missing', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => ({
    mealIdx: index('ingredients_meal_idx').on(table.mealId),
    normalizedIdx: index('ingredients_normalized_idx').on(table.normalizedName),
  }),
);

export type Ingredient = InferSelectModel<typeof ingredients>;

// ---------------------------------------------------------------------------
// import_batches — herkomst van geïmporteerde prijzen
// ---------------------------------------------------------------------------

export const importBatches = sqliteTable(
  'import_batches',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id').references(() => stores.id, { onDelete: 'set null' }),
    sourceId: text('source_id').references(() => dataSources.id, { onDelete: 'set null' }),
    format: text('format', { enum: ['csv', 'text', 'api', 'manual'] }).notNull(),
    fileName: text('file_name'),
    rowCount: integer('row_count').notNull().default(0),
    acceptedCount: integer('accepted_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    status: text('status', { enum: ['preview', 'committed', 'failed'] }).notNull().default('preview'),
    notes: text('notes', { mode: 'json' }).$type<string[]>().notNull().default([] as never),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => ({ storeIdx: index('import_batches_store_idx').on(table.storeId) }),
);

export type ImportBatch = InferSelectModel<typeof importBatches>;

// ---------------------------------------------------------------------------
// app_settings — sleutel/waarde instellingen die niet per gebruiker zijn
// ---------------------------------------------------------------------------

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export type AppSetting = InferSelectModel<typeof appSettings>;

export const schema = {
  users,
  stores,
  dataSources,
  products,
  productAliases,
  storeProducts,
  prices,
  offers,
  priceHistory,
  shoppingLists,
  shoppingItems,
  pantryItems,
  weeklyMenus,
  meals,
  ingredients,
  importBatches,
  appSettings,
};
