/**
 * Generieke feed-adapter voor een geautoriseerde prijs- en promotiebron.
 *
 * Deze adapter is de enige plek waar een winkelbron daadwerkelijk wordt
 * aangeroepen. Hij is volledig databron-onafhankelijk: zolang de bron de
 * hieronder gedocumenteerde JSON-vorm teruggeeft, werkt hij.
 *
 * Verwacht JSON-schema (GET {baseUrl}/offers, GET {baseUrl}/prices):
 *
 *   {
 *     "source": "Naam van je databron",
 *     "offers": [
 *       {
 *         "id": "artikel-id-in-de-winkel",
 *         "title": "Coca-Cola",
 *         "description": "1,5 l fles",
 *         "kind": "multipack",
 *         "offerPrice": 4.25,
 *         "regularPrice": 5.19,
 *         "conditions": { "bundleSize": 2, "bundlePrice": 4.25 },
 *         "validFrom": "2026-09-28",
 *         "validUntil": "2026-10-04",
 *         "gtin": "5449000000996",
 *         "packQuantity": 1.5,
 *         "packUnit": "l"
 *       }
 *     ]
 *   }
 *
 * Alles is optioneel behalve `title` en een geldige prijs. Ontbrekende of
 * ongeldige velden worden niet gokt: de regel wordt afgewezen met een reden.
 */

import type { StoreId } from '@boodschappen/core';
import type { SourceConfig } from '../config.js';
import { SourceError, type HttpClient } from '../services/http.js';
import {
  type AdapterHealth,
  type AdapterOffer,
  type AdapterPrice,
  type AdapterResult,
  type StoreAdapter,
  isValidDate,
  isValidKind,
  isValidPrice,
  requiredEnvVars,
  storeNameFor,
} from './types.js';

export interface GenericFeedAdapterOptions {
  storeId: StoreId;
  storeName: string;
  source: SourceConfig;
  /** Deel van de bron waar de aanbiedingen staan. Standaard '/offers'. */
  offersPath?: string;
  /** Deel van de bron waar de prijzen staan. Standaard '/prices'. */
  pricesPath?: string;
  requirements?: string[];
  documentationUrl?: string | null;
}

interface RawOffer {
  id?: unknown;
  storeProductId?: unknown;
  title?: unknown;
  name?: unknown;
  description?: unknown;
  kind?: unknown;
  offerPrice?: unknown;
  price?: unknown;
  regularPrice?: unknown;
  conditions?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  start?: unknown;
  end?: unknown;
  packDescription?: unknown;
  gtin?: unknown;
  ean?: unknown;
  packQuantity?: unknown;
  /** Alias die veel feeds gebruiken; komt overeen met packQuantity. */
  packSize?: unknown;
  packUnit?: unknown;
  inStock?: unknown;
}

interface RawEnvelope {
  source?: unknown;
  sourceName?: unknown;
  offers?: unknown;
  prices?: unknown;
  items?: unknown;
  data?: unknown;
}

export class GenericFeedAdapter implements StoreAdapter {
  readonly storeId: StoreId;
  readonly storeName: string;
  readonly requirements: string[];
  readonly documentationUrl: string | null;

  private readonly source: SourceConfig;
  private readonly offersPath: string;
  private readonly pricesPath: string;

  constructor(options: GenericFeedAdapterOptions) {
    this.storeId = options.storeId;
    this.storeName = options.storeName;
    this.source = options.source;
    this.offersPath = options.offersPath ?? '/offers';
    this.pricesPath = options.pricesPath ?? '/prices';
    this.documentationUrl = options.documentationUrl ?? null;
    this.requirements = options.requirements ?? [
      `Een officiële, geautoriseerde toegang tot de prijs- en promotiegegevens van ${options.storeName}.`,
      'Een API-sleutel of token uit een geldend contract of afspraak.',
      'Zonder deze gegevens kan de app geen prijzen tonen; er worden geen prijzen geschat.',
    ];
  }

  isConfigured(): boolean {
    return this.source.isConfigured;
  }

  describe(): AdapterHealth {
    if (!this.isConfigured()) {
      return {
        storeId: this.storeId,
        storeName: this.storeName,
        status: 'not_configured',
        message:
          `Er is nog geen officiële databron aan ${this.storeName} gekoppeld. ` +
          `Zonder die koppeling toont de app geen prijzen of aanbiedingen — er wordt niets verzonnen. ` +
          `Je kunt de prijzen ook zelf invoeren via Importeren.`,
        requiredConfiguration: this.requirements,
        documentationUrl: this.documentationUrl,
        requiredEnvVars: requiredEnvVars(this.storeId),
      };
    }
    return {
      storeId: this.storeId,
      storeName: this.storeName,
      status: 'connected',
      message: `Gekoppeld aan een geautoriseerde bron.`,
      requiredConfiguration: this.requirements,
      documentationUrl: this.documentationUrl,
      requiredEnvVars: requiredEnvVars(this.storeId),
    };
  }

  async fetchOffers(http: HttpClient): Promise<AdapterResult<AdapterOffer>> {
    const raw = await this.fetchSection(http, this.offersPath, 'offers');
    return this.parseOffers(raw.envelope, raw.sourceName);
  }

  async fetchPrices(http: HttpClient): Promise<AdapterResult<AdapterPrice>> {
    const raw = await this.fetchSection(http, this.pricesPath, 'prices');
    return this.parsePrices(raw.envelope, raw.sourceName);
  }

  private async fetchSection(
    http: HttpClient,
    path: string,
    key: 'offers' | 'prices',
  ): Promise<{ envelope: RawEnvelope; sourceName: string }> {
    if (!this.source.baseUrl) {
      throw new SourceError({
        kind: 'geblokkeerd',
        message: `Geen bron geconfigureerd voor ${this.storeName}.`,
        storeId: this.storeId,
        userMessage: `Er is geen bron geconfigureerd voor ${this.storeName}.`,
      });
    }

    const url = joinUrl(this.source.baseUrl, path);
    const headers: Record<string, string> = { ...this.source.headers };
    // De sleutel gaat hier in een header. Zij komt nooit in een log of response.
    if (this.source.apiKey) headers.Authorization = `Bearer ${this.source.apiKey}`;

    const payload = await http.getJson<RawEnvelope>(url, {
      storeId: this.storeId,
      label: `${this.storeName} ${key}`,
      headers,
    });

    const envelope = unwrap(payload);
    const sourceName =
      typeof payload.source === 'string'
        ? payload.source
        : typeof payload.sourceName === 'string'
          ? payload.sourceName
          : this.storeName;

    return { envelope, sourceName };
  }

  private parseOffers(envelope: RawEnvelope, sourceName: string): AdapterResult<AdapterOffer> {
    const list = pickList(envelope, 'offers');
    const items: AdapterOffer[] = [];
    const rejected: AdapterResult<AdapterOffer>['rejected'] = [];

    list.forEach((entry, index) => {
      const row = entry as RawOffer;
      const title = firstString(row.title, row.name);
      if (!title) {
        rejected.push({ raw: JSON.stringify(entry).slice(0, 200), reason: 'Geen productnaam' });
        return;
      }
      const offerPrice = firstNumber(row.offerPrice, row.price);
      if (!isValidPrice(offerPrice)) {
        rejected.push({ raw: title, reason: 'Ongeldige of ontbrekende actieprijs' });
        return;
      }
      if (row.kind !== undefined && !isValidKind(row.kind)) {
        rejected.push({ raw: title, reason: `Onbekende aanbiedingsvorm "${String(row.kind)}"` });
        return;
      }
      const regularPrice = firstNumber(row.regularPrice);
      if (row.regularPrice !== undefined && row.regularPrice !== null && !isValidPrice(regularPrice)) {
        rejected.push({ raw: title, reason: 'Ongeldige normale prijs' });
        return;
      }
      const validFrom = firstStringOrNull(row.validFrom, row.start);
      const validUntil = firstStringOrNull(row.validUntil, row.end);
      if (!isValidDate(validFrom) || !isValidDate(validUntil)) {
        rejected.push({ raw: title, reason: 'Ongeldige geldigheidsdatum' });
        return;
      }

      const { conditions, unknownKeys, invalidKeys } = sanitizeConditions(row.conditions);
      if (unknownKeys.length > 0) {
        rejected.push({
          raw: title,
          reason: `${describeKeys('Onbekende voorwaarde', 'Onbekende voorwaarden', unknownKeys)}. Zie docs/DATA_SOURCES.md voor de juiste namen.`,
        });
        return;
      }
      if (invalidKeys.length > 0) {
        rejected.push({
          raw: title,
          reason: describeKeys('Ongeldige waarde bij voorwaarde', 'Ongeldige waarden bij voorwaarden', invalidKeys),
        });
        return;
      }
      const packQuantity = firstNumber(row.packQuantity, row.packSize);
      if (packQuantity !== null && (!Number.isFinite(packQuantity) || packQuantity <= 0)) {
        rejected.push({ raw: title, reason: 'Ongeldige verpakkingsgrootte' });
        return;
      }

      items.push({
        storeProductId: firstString(row.storeProductId, row.id) ?? `${this.storeId}-${index}-${title}`,
        title,
        description: firstStringOrNull(row.description),
        kind: (row.kind as AdapterOffer['kind']) ?? 'price_drop',
        offerPrice,
        regularPrice: regularPrice ?? null,
        conditions,
        validFrom,
        validUntil,
        packDescription: firstStringOrNull(row.packDescription),
        gtin: firstStringOrNull(row.gtin, row.ean),
        packQuantity,
        packUnit: firstStringOrNull(row.packUnit),
      });
    });

    return { items, rejected, sourceName, fetchedAt: new Date().toISOString() };
  }

  private parsePrices(envelope: RawEnvelope, sourceName: string): AdapterResult<AdapterPrice> {
    const list = pickList(envelope, 'prices');
    const items: AdapterPrice[] = [];
    const rejected: AdapterResult<AdapterPrice>['rejected'] = [];

    list.forEach((entry, index) => {
      const row = entry as RawOffer;
      const title = firstString(row.title, row.name);
      if (!title) {
        rejected.push({ raw: JSON.stringify(entry).slice(0, 200), reason: 'Geen productnaam' });
        return;
      }
      // `price` is de alias die de meeste feeds voor /prices gebruiken; zonder
      // deze alias werd het voorbeeld uit docs/DATA_SOURCES.md geweigerd.
      const regularPrice = firstNumber(row.regularPrice, row.price);
      if (!isValidPrice(regularPrice)) {
        rejected.push({ raw: title, reason: 'Ongeldige of ontbrekende prijs' });
        return;
      }
      const offerPrice = firstNumber(row.offerPrice, row.price);
      if (row.offerPrice !== undefined && row.offerPrice !== null && !isValidPrice(offerPrice)) {
        rejected.push({ raw: title, reason: 'Ongeldige actieprijs' });
        return;
      }
      if (row.kind !== undefined && !isValidKind(row.kind)) {
        rejected.push({ raw: title, reason: `Onbekende aanbiedingsvorm "${String(row.kind)}"` });
        return;
      }

      const { conditions, unknownKeys, invalidKeys } = sanitizeConditions(row.conditions);
      if (unknownKeys.length > 0) {
        rejected.push({
          raw: title,
          reason: `${describeKeys('Onbekende voorwaarde', 'Onbekende voorwaarden', unknownKeys)}. Zie docs/DATA_SOURCES.md voor de juiste namen.`,
        });
        return;
      }
      if (invalidKeys.length > 0) {
        rejected.push({
          raw: title,
          reason: describeKeys('Ongeldige waarde bij voorwaarde', 'Ongeldige waarden bij voorwaarden', invalidKeys),
        });
        return;
      }

      const packQuantity = firstNumber(row.packQuantity, row.packSize);
      if (packQuantity !== null && (!Number.isFinite(packQuantity) || packQuantity <= 0)) {
        rejected.push({ raw: title, reason: 'Ongeldige verpakkingsgrootte' });
        return;
      }

      items.push({
        storeProductId: firstString(row.storeProductId, row.id) ?? `${this.storeId}-${index}-${title}`,
        title,
        regularPrice,
        offerPrice: offerPrice ?? null,
        conditions,
        kind: (row.kind as AdapterPrice['kind']) ?? (offerPrice ? 'price_drop' : undefined),
        gtin: firstStringOrNull(row.gtin, row.ean),
        packDescription: firstStringOrNull(row.packDescription),
        packQuantity,
        packUnit: firstStringOrNull(row.packUnit),
        inStock: row.inStock === undefined ? true : Boolean(row.inStock),
        observedAt: new Date().toISOString(),
        sourceName,
      });
    });

    return { items, rejected, sourceName, fetchedAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Hulpfuncties voor het parseren
// ---------------------------------------------------------------------------

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

/** Accepteert zowel `{offers: [...]}` als `{data: {offers: [...]}}` als een kale lijst. */
function unwrap(payload: unknown): RawEnvelope {
  if (Array.isArray(payload)) return { offers: payload, prices: payload };
  if (payload && typeof payload === 'object') return payload as RawEnvelope;
  return {};
}

function pickList(envelope: RawEnvelope, key: 'offers' | 'prices'): unknown[] {
  const direct = envelope[key];
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(envelope.items)) return envelope.items;
  if (envelope.data && typeof envelope.data === 'object') {
    const nested = (envelope.data as RawEnvelope)[key];
    if (Array.isArray(nested)) return nested;
    if (Array.isArray((envelope.data as RawEnvelope).items)) return (envelope.data as RawEnvelope).items as unknown[];
  }
  if (key === 'offers' && Array.isArray(envelope.prices)) return envelope.prices;
  if (key === 'prices' && Array.isArray(envelope.offers)) return envelope.offers;
  return [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstStringOrNull(...values: unknown[]): string | null {
  return firstString(...values);
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      // "€ 4,25" of "4.25" -> 4.25
      const cleaned = value.replace(/[^\d,.\-]/g, '').replace(',', '.');
      if (cleaned.length === 0) continue;
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

const VALID_CONDITION_KEYS = new Set([
  'bundleSize', 'bundlePrice', 'secondUnitDiscount', 'minQuantity', 'maxPerPerson',
  'requiresLoyaltyCard', 'loyaltyCardName', 'instantSavings', 'giftValue', 'discountPercent',
]);

/**
 * Leest de voorwaarden van een aanbieding.
 *
 * Onbekende of ongeldige sleutels worden NIET stilzwijgend genegeerd. Een
 * voorwaarde weglaten is erger dan de aanbieding weigeren: "alleen met
 * klantenkaart" zou dan verdwijnen en de prijs zou als gewoon gelden. Daarom
 * geeft deze functie de sleutels terug die niet begrepen werden, zodat de
 * aanbieding met een duidelijke reden wordt geweigerd en de winkelier zijn
 * feed kan nakijken.
 */
/** "Onbekende voorwaarde: x" of "Onbekende voorwaarden: x, y". */
function describeKeys(singular: string, plural: string, keys: string[]): string {
  return `${keys.length === 1 ? singular : plural}: ${keys.join(', ')}`;
}

function sanitizeConditions(value: unknown): {
  conditions: AdapterOffer['conditions'];
  unknownKeys: string[];
  invalidKeys: string[];
} {
  if (!value || typeof value !== 'object') return { conditions: {}, unknownKeys: [], invalidKeys: [] };
  const result: Record<string, unknown> = {};
  const unknownKeys: string[] = [];
  const invalidKeys: string[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!VALID_CONDITION_KEYS.has(key)) {
      unknownKeys.push(key);
      continue;
    }
    if (typeof raw === 'number') {
      if (Number.isFinite(raw) && raw >= 0) result[key] = raw;
      else invalidKeys.push(key);
    } else if (typeof raw === 'boolean') {
      result[key] = raw;
    } else if (typeof raw === 'string' && raw.length > 0) {
      result[key] = raw;
    } else {
      invalidKeys.push(key);
    }
  }
  return { conditions: result as AdapterOffer['conditions'], unknownKeys, invalidKeys };
}

export { storeNameFor };
