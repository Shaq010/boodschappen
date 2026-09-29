/**
 * Adaptercontract voor winkels.
 *
 * Dit is het contract dat elke winkel moet implementeren. Het is bewust
 * eenvoudig en leveranciers-onafhankelijk: één winkel levert één lijst met
 * aanbiedingen en één lijst met prijzen, met de voorwaarden erin.
 *
 * BELANGRIJK OVER DATAHERKOMST
 * ----------------------------
 * Lidl, Albert Heijn, Dirk en Kruidvat publiceren GEEN officiële, openbare
 * API voor prijzen en aanbiedingen. Hun websites beschermen hun prijzen tegen
 * geautomatiseerd ophalen en hun Algemene Voorwaarden verbieden dat. Deze app
 * haalt daarom GEEN prijzen van hun websites.
 *
 * Wat wél kan, en wat de app ondersteunt:
 *  1. Een officiële, geautoriseerde koppeling: een commerciële prijs- en
 *     promotiedatabron met een contract, of een rechtstreekse feed van de
 *     winkel zelf. Configureer die met SOURCE_<WINKEL>_BASE_URL en
 *     SOURCE_<WINKEL>_API_KEY.
 *  2. Eigen invoer: een CSV of tekstbestand met de prijzen en acties uit het
 *     weekaanbod of het eigen klantenkaartoverzicht.
 *
 * De `GenericFeedAdapter` hieronder implementeert (1). Hij verwacht een
 * JSON-structuur; het contract is zo eenvoudig mogelijk gehouden zodat elke
 * bron er aan te passen valt. Wat een bron ook retourneert, de uitvoer wordt
 * gevalideerd: onbekende velden of ongeldige prijzen worden afgewezen in plaats
 * van aangenomen. Er worden nooit prijzen verzonnen of geschat.
 */

import type { OfferKind, StoreId } from '@boodschappen/core';
import type { SourceConfig } from '../config.js';
import type { HttpClient } from '../services/http.js';

export interface AdapterOffer {
  /** Artikel-id binnen de winkel. */
  storeProductId: string;
  /** Productnaam zoals de winkel hem noemt. */
  title: string;
  description?: string | null;
  kind: OfferKind;
  /** Actieprijs per verpakking, in euro's. */
  offerPrice: number;
  /** Normale prijs per verpakking, indien bekend. */
  regularPrice?: number | null;
  conditions: {
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
  };
  /** ISO-datum. */
  validFrom?: string | null;
  validUntil?: string | null;
  /** Beschrijving van de verpakking, bv. "1,5 l fles". */
  packDescription?: string | null;
  /** EAN/GTIN, indien bekend. */
  gtin?: string | null;
  /** Eenheid en hoeveelheid van de verpakking, bv. 1.5 liter. */
  packQuantity?: number | null;
  packUnit?: string | null;
}

export interface AdapterPrice {
  storeProductId: string;
  title: string;
  regularPrice: number;
  offerPrice?: number | null;
  conditions?: AdapterOffer['conditions'];
  kind?: OfferKind;
  gtin?: string | null;
  packDescription?: string | null;
  packQuantity?: number | null;
  packUnit?: string | null;
  inStock?: boolean;
  observedAt?: string;
  sourceName?: string;
}

export interface AdapterResult<T> {
  items: T[];
  /** Aantal afgewezen regels, met reden, voor de statuspagina. */
  rejected: Array<{ raw: string; reason: string }>;
  /** Naam van de bron zoals die in de interface getoond wordt. */
  sourceName: string;
  fetchedAt: string;
}

export interface AdapterHealth {
  storeId: StoreId;
  storeName: string;
  status: 'connected' | 'not_configured' | 'network_disabled' | 'error' | 'rate_limited' | 'syncing';
  message: string;
  requiredConfiguration: string[];
  documentationUrl: string | null;
  /** Wat de gebruiker moet invullen om deze bron te activeren. */
  requiredEnvVars: string[];
}

export interface StoreAdapter {
  readonly storeId: StoreId;
  readonly storeName: string;
  /** Beschrijft wat er nodig is om deze bron te gebruiken. */
  readonly requirements: string[];
  readonly documentationUrl: string | null;
  isConfigured(): boolean;
  describe(): AdapterHealth;
  fetchOffers(http: HttpClient): Promise<AdapterResult<AdapterOffer>>;
  fetchPrices(http: HttpClient): Promise<AdapterResult<AdapterPrice>>;
}

/** Hulpvalidatie: een prijs moet een positief, eindig getal zijn. */
export function isValidPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000;
}

export function isValidDate(value: unknown): value is string | null {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  return !Number.isNaN(Date.parse(value));
}

const VALID_KINDS: readonly OfferKind[] = [
  'price_drop', 'multipack', 'second_half', 'loyalty',
  'min_quantity', 'bundle', 'per_volume', 'cashback',
];

export function isValidKind(value: unknown): value is OfferKind {
  return typeof value === 'string' && (VALID_KINDS as readonly string[]).includes(value);
}

/** Rondt centbedragen netjes af en voorkomt drijvende-kommaartekens. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

export function fromCents(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return Math.round(cents) / 100;
}

export function storeNameFor(storeId: StoreId): string {
  const names: Record<StoreId, string> = {
    lidl: 'Lidl',
    albert_heijn: 'Albert Heijn',
    dirk: 'Dirk',
    kruidvat: 'Kruidvat',
  };
  return names[storeId];
}

/** Vereiste omgevingsvariabelen per winkel (zonder de waarden!). */
export function requiredEnvVars(storeId: StoreId): string[] {
  const slug = storeSlug(storeId);
  return [`SOURCE_${slug}_BASE_URL`, `SOURCE_${slug}_API_KEY`];
}

export function storeSlug(storeId: StoreId): string {
  switch (storeId) {
    case 'lidl':
      return 'LIDL';
    case 'albert_heijn':
      return 'ALBERT_HEIJN';
    case 'dirk':
      return 'DIRK';
    case 'kruidvat':
      return 'KRUIDVAT';
  }
}

export function sourceConfigFor(config: Record<string, SourceConfig>, storeId: StoreId): SourceConfig | null {
  return config[storeSlug(storeId)] ?? null;
}
