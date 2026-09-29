/**
 * Contracten tussen backend en frontend.
 *
 * Dit bestand bevat ALLEEN vormen en teksten — nooit secrets. Geheimen
 * komen uitsluitend uit de backend en worden nooit over deze contracten
 * vervoerd. De frontend krijgt bijvoorbeeld `configured: true` te zien, maar
 * nooit de API-key zelf.
 */

import { z } from 'zod';
import type { UnitDimension } from './units.js';
import type { ProductCategory } from './normalize.js';
import type { OfferConditions, OfferKind } from './offers.js';
import type { Weekday } from './menu.js';
import type { DrinkKind } from './drinks.js';

// ---------------------------------------------------------------------------
// Winkels
// ---------------------------------------------------------------------------

export const STORE_IDS = ['lidl', 'albert_heijn', 'dirk', 'kruidvat'] as const;
export type StoreId = (typeof STORE_IDS)[number];

export const STORE_META: Record<StoreId, { name: string; shortName: string; color: string; order: number }> = {
  lidl: { name: 'Lidl', shortName: 'Lidl', color: '#0050aa', order: 0 },
  albert_heijn: { name: 'Albert Heijn', shortName: 'AH', color: '#00a650', order: 1 },
  dirk: { name: 'Dirk', shortName: 'Dirk', color: '#0a5ca8', order: 2 },
  kruidvat: { name: 'Kruidvat', shortName: 'Kruidvat', color: '#7b2d8b', order: 3 },
};

export const storeIdSchema = z.enum(STORE_IDS);

// ---------------------------------------------------------------------------
// Bronstatus
// ---------------------------------------------------------------------------

/**
 * `network_disabled` staat apart van `error`: het netwerk uitzetten is een
 * bewuste keuze van de gebruiker, geen storing. Dat verschil moet je in de
 * interface kunnen zien, anders lijkt er iets mis te zijn.
 */
export const SOURCE_STATUS = [
  'connected',
  'not_configured',
  'network_disabled',
  'error',
  'rate_limited',
  'syncing',
] as const;
export type SourceStatus = (typeof SOURCE_STATUS)[number];

/**
 * Publieke statusinformatie over een databron. Bevat bewust GEEN url, key of
 * ander geheim — alleen de feiten die de gebruiker nodig heeft.
 */
export interface DataSourceStatus {
  storeId: string;
  storeName: string;
  status: SourceStatus;
  /** Korte, Nederlandse uitleg voor de gebruiker. */
  message: string;
  /** Wat er nodig is om deze bron aan de slag te krijgen. */
  requiredConfiguration: string[];
  /** Een officiële, door de bron zelf beschikbare documentatielink indien bekend. */
  documentationUrl: string | null;
  /** Laatste geslaagde synchronisatie (ISO 8601). */
  lastSyncedAt: string | null;
  /** Laatste poging, geslaagd of niet. */
  lastAttemptAt: string | null;
  /** Aantal aanbiedingen in de cache. */
  cachedOfferCount: number;
  /** Aantal prijzen in de cache. */
  cachedPriceCount: number;
  /** Hoe oud de cache is in seconden. */
  cacheAgeSeconds: number | null;
  /** Aanbiedingen die vandaag (of vandaag-vorig) geldig zijn. */
  activeOfferCount: number;
}

export const dataSourcesResponseSchema = z.object({
  stores: z.array(
    z.object({
      storeId: z.string(),
      storeName: z.string(),
      status: z.enum(SOURCE_STATUS),
      message: z.string(),
      requiredConfiguration: z.array(z.string()),
      documentationUrl: z.string().nullable(),
      lastSyncedAt: z.string().nullable(),
      lastAttemptAt: z.string().nullable(),
      cachedOfferCount: z.number(),
      cachedPriceCount: z.number(),
      cacheAgeSeconds: z.number().nullable(),
      activeOfferCount: z.number(),
    }),
  ),
  lastUpdatedAt: z.string().nullable(),
  /** Waarschuwing als er helemaal geen bron gekoppeld is. */
  globalNotice: z.string().nullable(),
});

export type DataSourcesResponse = z.infer<typeof dataSourcesResponseSchema>;

// ---------------------------------------------------------------------------
// Producten
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  canonicalName: z.string(),
  brand: z.string().nullable(),
  category: z.enum([
    'groente', 'fruit', 'zuivel', 'vlees', 'vis', 'brood',
    'voorradskast', 'snacks', 'drank', 'dieet', 'huishouden', 'overig',
  ]),
  drinkKind: z.enum([
    'frisdrank', 'water', 'sap', 'energie', 'bier', 'wijn', 'sterkedrank', 'koffie-thee', 'overig',
  ]).nullable(),
  unit: z.string().nullable(),
  unitDimension: z.enum(['mass', 'volume', 'count', 'packaging']).nullable(),
  unitAmount: z.number().nullable(),
  gtin: z.string().nullable(),
  source: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const matchSuggestionSchema = z.object({
  productId: z.string(),
  name: z.string(),
  confidence: z.number(),
  reason: z.string(),
});
export type MatchSuggestion = z.infer<typeof matchSuggestionSchema>;

/** Antwoord op "is dit hetzelfde product?" */
export const productMatchSchema = z.object({
  status: z.enum(['match', 'suggest', 'none']),
  input: z.string(),
  product: productSchema.nullable(),
  suggestions: z.array(matchSuggestionSchema),
  /** Gekozen canonieke productnaam. */
  canonicalName: z.string(),
  category: z.string(),
});
export type ProductMatch = z.infer<typeof productMatchSchema>;

// ---------------------------------------------------------------------------
// Hoeveelheden
// ---------------------------------------------------------------------------

export const quantitySchema = z.object({
  dimension: z.enum(['mass', 'volume', 'count', 'packaging']),
  amount: z.number(),
  unit: z.string(),
  originalUnit: z.string(),
  originalAmount: z.number(),
});
export type QuantityDto = z.infer<typeof quantitySchema>;

// ---------------------------------------------------------------------------
// Boodschappenlijst
// ---------------------------------------------------------------------------

export const shoppingItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable(),
  name: z.string(),
  quantity: quantitySchema,
  checked: z.boolean(),
  inPantry: z.boolean(),
  category: z.string(),
  isDrink: z.boolean(),
  note: z.string().nullable(),
  /** Waar dit item vandaan komt: handmatig, weekmenu of import. */
  origin: z.enum(['manual', 'menu', 'import']),
  sortOrder: z.number(),
  updatedAt: z.string(),
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;

export const parseRequestSchema = z.object({
  text: z.string().min(1).max(20_000),
  /** Bevestigde keuzes van de gebruiker per regel. */
  overrides: z.record(z.string(), z.object({ unit: z.string().optional(), amount: z.number().optional() })).optional(),
});
export type ParseRequest = z.infer<typeof parseRequestSchema>;

export const previewItemSchema = z.object({
  raw: z.string(),
  name: z.string(),
  quantity: quantitySchema,
  quantityLabel: z.string(),
  confidence: z.number(),
  assumptions: z.array(z.object({ code: z.string(), message: z.string() })),
  match: z.enum(['new', 'matched', 'suggest', 'none']),
  matchStatus: z.string(),
  suggestions: z.array(matchSuggestionSchema),
  productId: z.string().nullable(),
  /** Index in de invoertekst, zodat de UI de regels kan koppelen. */
  index: z.number(),
});
export type PreviewItem = z.infer<typeof previewItemSchema>;

export const parsePreviewResponseSchema = z.object({
  items: z.array(previewItemSchema),
  ignored: z.array(z.string()),
  /** Aantal regels dat de gebruiker moet bevestigen. */
  needsConfirmation: z.number(),
});
export type ParsePreviewResponse = z.infer<typeof parsePreviewResponseSchema>;

export const addItemSchema = z.object({
  name: z.string().min(1).max(200),
  amount: z.number().positive().max(100_000).optional(),
  unit: z.string().max(20).optional(),
  productId: z.string().nullable().optional(),
  origin: z.enum(['manual', 'menu', 'import']).optional(),
  note: z.string().max(500).nullable().optional(),
});
export type AddItemInput = z.infer<typeof addItemSchema>;

export const updateItemSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  amount: z.number().positive().max(100_000).optional(),
  unit: z.string().max(20).optional(),
  checked: z.boolean().optional(),
  inPantry: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  productId: z.string().nullable().optional(),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const bulkCheckSchema = z.object({
  itemIds: z.array(z.string()),
  checked: z.boolean(),
});
export type BulkCheckInput = z.infer<typeof bulkCheckSchema>;

// ---------------------------------------------------------------------------
// Weekmenu
// ---------------------------------------------------------------------------

export const ingredientSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: quantitySchema,
  quantityLabel: z.string(),
  unit: z.string().nullable(),
  amount: z.number(),
  inPantry: z.boolean(),
  onlyIfMissing: z.boolean(),
  productId: z.string().nullable(),
  sortOrder: z.number(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const mealSchema = z.object({
  id: z.string(),
  day: z.enum(['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']),
  name: z.string(),
  note: z.string().nullable(),
  sortOrder: z.number(),
  ingredients: z.array(ingredientSchema),
  createdAt: z.string(),
});
export type Meal = z.infer<typeof mealSchema>;

export const weeklyMenuSchema = z.object({
  id: z.string(),
  weekStart: z.string(),
  title: z.string().nullable(),
  meals: z.array(mealSchema),
  updatedAt: z.string(),
});
export type WeeklyMenu = z.infer<typeof weeklyMenuSchema>;

export const saveMealSchema = z.object({
  day: z.enum(['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']),
  name: z.string().min(1).max(200),
  note: z.string().max(1000).nullable().optional(),
  ingredients: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(200),
        amount: z.number().nonnegative().max(100_000).default(1),
        unit: z.string().max(20).nullable().default(null),
        inPantry: z.boolean().default(false),
        onlyIfMissing: z.boolean().default(false),
        productId: z.string().nullable().default(null),
      }),
    )
    .default([]),
});
export type SaveMealInput = z.infer<typeof saveMealSchema>;

export const generateListSchema = z.object({
  /** Vervangt de bestaande lijst of voegt eraan toe. */
  mode: z.enum(['replace', 'merge']).default('merge'),
  /** Voeg ook toe aan de huidige boodschappenlijst. */
  applyToCurrentList: z.boolean().default(true),
  /** Sla producten over die al in huis staan. */
  skipPantry: z.boolean().default(true),
});
export type GenerateListInput = z.infer<typeof generateListSchema>;

export const generatedListSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: quantitySchema,
      quantityLabel: z.string(),
      category: z.string(),
      inPantry: z.boolean(),
      sources: z.array(
        z.object({
          day: z.string(),
          mealName: z.string(),
          ingredientName: z.string(),
          quantityLabel: z.string(),
        }),
      ),
    }),
  ),
  conflicts: z.array(
    z.object({
      name: z.string(),
      message: z.string(),
      parts: z.array(z.object({ name: z.string(), quantityLabel: z.string(), mealName: z.string() })),
    }),
  ),
  skippedPantry: z.array(z.object({ name: z.string(), quantityLabel: z.string() })),
  totalItems: z.number(),
});
export type GeneratedList = z.infer<typeof generatedListSchema>;

// ---------------------------------------------------------------------------
// Prijzen en aanbiedingen
// ---------------------------------------------------------------------------

export const offerConditionsSchema = z.object({
  bundleSize: z.number().optional(),
  bundlePrice: z.number().optional(),
  secondUnitDiscount: z.number().optional(),
  minQuantity: z.number().optional(),
  maxPerPerson: z.number().optional(),
  requiresLoyaltyCard: z.boolean().optional(),
  loyaltyCardName: z.string().optional(),
  instantSavings: z.number().optional(),
  giftValue: z.number().optional(),
  discountPercent: z.number().optional(),
});
export type OfferConditionsDto = z.infer<typeof offerConditionsSchema>;

export const priceQuoteSchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  unitPrice: z.number(),
  unitPriceWithoutCard: z.number().nullable(),
  regularPrice: z.number().nullable(),
  savingsPerUnit: z.number(),
  savingsPercent: z.number().nullable(),
  basketCost: z.number(),
  basketCostWithoutCard: z.number().nullable(),
  extraUnits: z.number(),
  label: z.string(),
  notices: z.array(z.string()),
  warnings: z.array(z.string()),
  requiresCard: z.boolean(),
  perKg: z.number().nullable(),
  perLiter: z.number().nullable(),
  perPiece: z.number().nullable(),
  offerKind: z.enum(['price_drop', 'multipack', 'second_half', 'loyalty', 'min_quantity', 'bundle', 'per_volume', 'cashback']),
  isOffer: z.boolean(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  productName: z.string(),
  packDescription: z.string().nullable(),
  sourceName: z.string(),
});
export type PriceQuoteDto = z.infer<typeof priceQuoteSchema>;

export const offerSchema = priceQuoteSchema.extend({
  id: z.string(),
  description: z.string(),
  conditions: offerConditionsSchema,
  drinkKind: z.string().nullable(),
  relevance: z.enum(['op-lijst', 'drank', 'aanbevolen']).nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
});
export type Offer = z.infer<typeof offerSchema>;

export const offersResponseSchema = z.object({
  offers: z.array(offerSchema),
  /** Aanbiedingen die vandaag geldig zijn. */
  activeCount: z.number(),
  /** Onderdelen die nog niet gekoppeld zijn. */
  storeStatus: z.array(
    z.object({
      storeId: z.string(),
      storeName: z.string(),
      status: z.string(),
      message: z.string(),
    }),
  ),
  lastUpdatedAt: z.string().nullable(),
  generatedAt: z.string(),
  notice: z.string().nullable(),
});
export type OffersResponse = z.infer<typeof offersResponseSchema>;

export const drinksResponseSchema = z.object({
  drinks: z.array(offerSchema),
  requestedTerms: z.array(z.string()),
  onList: z.array(z.object({ name: z.string(), drinkKind: z.string() })),
  storeStatus: offersResponseSchema.shape.storeStatus,
  lastUpdatedAt: z.string().nullable(),
  notice: z.string().nullable(),
});
export type DrinksResponse = z.infer<typeof drinksResponseSchema>;

// ---------------------------------------------------------------------------
// Prijsvergelijking en totalen
// ---------------------------------------------------------------------------

export const comparisonRowSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  quantity: quantitySchema,
  quantityLabel: z.string(),
  checked: z.boolean(),
  inPantry: z.boolean(),
  category: z.string(),
  isDrink: z.boolean(),
  quotes: z.array(priceQuoteSchema),
  cheapestStoreId: z.string().nullable(),
  cheapestStoreName: z.string().nullable(),
  /** Verschil met de duurste winkel, in euro. */
  spread: z.number().nullable(),
  status: z.enum(['vergeleken', 'geen-prijs', 'gedeeltelijk']),
});
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;

export const comparisonResponseSchema = z.object({
  rows: z.array(comparisonRowSchema),
  comparedCount: z.number(),
  withoutPriceCount: z.number(),
  storeStatus: offersResponseSchema.shape.storeStatus,
  lastUpdatedAt: z.string().nullable(),
  notice: z.string().nullable(),
});
export type ComparisonResponse = z.infer<typeof comparisonResponseSchema>;

export const storeLineSchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  itemCount: z.number(),
  subtotal: z.number(),
  items: z.array(
    z.object({
      itemId: z.string(),
      itemName: z.string(),
      cost: z.number(),
      quantity: z.string(),
      label: z.string(),
      warnings: z.array(z.string()),
    }),
  ),
});

export const storePlanSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  total: z.number(),
  pricedItemCount: z.number(),
  unpricedItemCount: z.number(),
  lines: z.array(storeLineSchema),
  storeIds: z.array(z.string()),
  isComplete: z.boolean(),
  missingItems: z.array(z.string()),
});

export const totalsResponseSchema = z.object({
  perStore: z.array(storePlanSchema),
  cheapestCombination: storePlanSchema,
  minimalStores: storePlanSchema,
  cheapestTotal: z.number(),
  minimalStoresTotal: z.number(),
  mostExpensiveTotal: z.number(),
  savingsVsMostExpensive: z.number(),
  unpriced: z.array(z.object({ itemId: z.string(), name: z.string(), reason: z.string() })),
  totalPricedItems: z.number(),
  totalUnpricedItems: z.number(),
  hasCompletePricing: z.boolean(),
  storeStatus: offersResponseSchema.shape.storeStatus,
  lastUpdatedAt: z.string().nullable(),
  notice: z.string().nullable(),
});
export type TotalsResponse = z.infer<typeof totalsResponseSchema>;

// ---------------------------------------------------------------------------
// Vandaag
// ---------------------------------------------------------------------------

export const todayResponseSchema = z.object({
  date: z.string(),
  weekday: z.string(),
  weekdayLabel: z.string(),
  meals: z.array(mealSchema),
  /** Ingrediënten van vandaag, na samenvoegen. */
  needed: z.array(
    z.object({
      name: z.string(),
      quantity: quantitySchema,
      quantityLabel: z.string(),
      category: z.string(),
      inPantry: z.boolean(),
      isDrink: z.boolean(),
      sources: z.array(z.object({ mealName: z.string(), quantityLabel: z.string() })),
      /** Komt dit ook op de boodschappenlijst voor? */
      onShoppingList: z.boolean(),
    }),
  ),
  /** Producten uit het weekmenu die de gebruiker al in huis heeft. */
  inPantry: z.array(z.object({ name: z.string(), quantityLabel: z.string(), mealName: z.string() })),
  pantryItems: z.array(z.object({ id: z.string(), name: z.string(), quantityLabel: z.string() })),
  hasMenu: z.boolean(),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const dashboardResponseSchema = z.object({
  greeting: z.string(),
  date: z.string(),
  weekdayLabel: z.string(),
  shopping: z.object({
    total: z.number(),
    open: z.number(),
    checked: z.number(),
    inPantry: z.number(),
  }),
  today: z.object({
    mealCount: z.number(),
    mealNames: z.array(z.string()),
    neededCount: z.number(),
  }),
  offers: z.object({
    total: z.number(),
    relevant: z.number(),
    drinks: z.number(),
  }),
  savings: z.object({
    estimated: z.number(),
    currency: z.string(),
  }),
  unpricedCount: z.number(),
  storeStatus: offersResponseSchema.shape.storeStatus,
  lastUpdatedAt: z.string().nullable(),
  dataNotice: z.string().nullable(),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------

export const settingsSchema = z.object({
  userName: z.string().max(80).default('there'),
  /** Voorkeur voor het optimaliseren. */
  optimization: z.enum(['cheapest', 'minimal_stores']).default('cheapest'),
  /** Tel aanbiedingen die een klantenkaart vereisen mee tegen de actieprijs. */
  includeCardOnlyDeals: z.boolean().default(true),
  /** Aantal decimalen in prijzen. */
  priceDecimals: z.number().int().min(0).max(4).default(2),
  /** Gewenste cache-levensduur in seconden voor het ophalen van aanbiedingen. */
  offerCacheSeconds: z.number().int().min(60).max(86_400).default(3_600),
  /** Toon producten zonder prijs in de totalen. */
  showUnpricedInTotals: z.boolean().default(true),
  autoMarkPantryAsInHouse: z.boolean().default(false),
  language: z.literal('nl').default('nl'),
});
export type Settings = z.infer<typeof settingsSchema>;

export type SettingsUpdate = Partial<Settings>;

// ---------------------------------------------------------------------------
// Overig
// ---------------------------------------------------------------------------

export const importRequestSchema = z.object({
  /** CSV of tekst met winkel, product, prijs, aanbieding. */
  content: z.string().min(1).max(2_000_000),
  storeId: storeIdSchema,
  /** 'csv' of 'text'. */
  format: z.enum(['csv', 'text']).default('csv'),
  /** Bij CSV: de kolomnaam die de prijs bevat. */
  priceColumn: z.string().default('prijs'),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const importPreviewSchema = z.object({
  rows: z.array(
    z.object({
      raw: z.array(z.string().nullable()),
      name: z.string(),
      price: z.number().nullable(),
      quantity: z.string().nullable(),
      condition: z.string().nullable(),
      isOffer: z.boolean(),
      warnings: z.array(z.string()),
    }),
  ),
  detectedColumns: z.array(z.string()),
  validRows: z.number(),
  invalidRows: z.number(),
  notices: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  database: z.object({ ok: z.boolean(), message: z.string() }),
  stores: z.object({ total: z.number(), connected: z.number() }),
  serverTime: z.string(),
  /** Bewijs dat er geen secrets naar de client gaan. */
  secretsExposed: z.literal(false),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export type { UnitDimension, ProductCategory, OfferConditions, OfferKind, Weekday, DrinkKind };
