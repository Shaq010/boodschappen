/**
 * PrijsProfeet-adapter.
 *
 * PrijsProfeet is één geautoriseerde Nederlandse prijsbron die tien
 * supermarkten aanbiedt met één API-sleutel. Dat is een andere vorm dan de
 * `GenericFeedAdapter` verwacht: die gaat uit van één bron per winkel. Hier is
 * er één sleutel voor drie winkels, dus ook één rate limit, één paginering en
 * één stroom met gemengde rijen.
 *
 * Wat hier dus níet gebeurt en waarom:
 *
 *  - De sleutel wordt niet drie keer geconfigureerd. Eén `PRIJSPROFEET_API_KEY`
 *    levert Lidl, Albert Heijn en Dirk. Per winkel wordt met `?retailer=`
 *    gefilterd, zodat elke winkel alleen zijn eigen rijen ophaalt. Zo blijft
 *    het aantal verzoeken laag (ruim 40 pagina's voor drie winkels) en wordt de
 *    key niet drie keer belast.
 *
 *  - Er wordt niets van de winkel zelf gehaald. Alleen dit officiële endpoint.
 *
 *  - Kruidvat zit niet in PrijsProfeet: het is een drogist en geen supermarkt.
 *    Voor Kruidvat blijft de bron daarom `not_configured` en zegt de app dat
 *    eerlijk. Er wordt geen andere bron bij verzonnen.
 *
 * BELANGRIJK: alleen acties van VANDAAG
 * -------------------------------------
 * Ongeveer een derde van de aanbiedingen in de catalogus begint pas later
 * (`promotion_status: "upcoming"`). Dat is prijsinformatie die vandaag nog
 * niet te kopen is. Zonder filter zou de app een prijs tonen die je vandaag
 * niet kunt betalen, dus dat zou precies de leugen zijn die deze app niet wil
 * vertellen. Zulke rijen worden daarom afgewezen met een reden, niet stil
 * genegeerd.
 *
 * Prijsvelden
 * ------------
 * `price` is de prijs PER STUK. `multi_buy_quantity` en `multi_buy_price`
 * beschrijven het pakket: "3 voor €0,89" is quantity 3, price 0,89. Dat is
 * precies de `bundleSize`/`bundlePrice`-vorm die de kern al kent, en die rekent
 * bovendien uit dat je voor één exemplaar het hele pakket moet betalen.
 *
 * Let op `quantity` versus `unit`: bij "100 g" met unit "kg" is 100 g de
 * verpakking en kg de vergelijkingsseenheid. `unit` is dus NIET de
 * verpakkingseenheid; wie die als verpakking neemt, rekent met pakken van
 * 100 kg.
 */

import type { OfferKind, StoreId } from '@boodschappen/core';
import { PRIJSPROFEET_STORE_SLUGS } from '../config.js';
import { SourceError, type HttpClient } from '../services/http.js';
import {
  type AdapterHealth,
  type AdapterOffer,
  type AdapterPrice,
  type AdapterResult,
  type StoreAdapter,
  isValidPrice,
  storeNameFor,
} from './types.js';

export const PRIJSPROFEET_DOC_URL = 'https://www.prijsprofeet.nl/api';
const DEFAULT_BASE_URL = 'https://www.prijsprofeet.nl/api/v1';
const PAGE_SIZE = 100;
/** Bovengrens tegen een oneindige paginering als `total` onbetrouwbaar is. */
const MAX_PAGES = 60;

/**
 * Winkels die PrijsProfeit daadwerkelijk aanbiedt, met hun slug in de API.
 * Staat in config.ts, zodat het adapterregister en de frontendstatus dezelfde
 * lijst gebruiken en niet uit elkaar kunnen lopen.
 */
const COVERED_STORES: Partial<Record<StoreId, string>> = PRIJSPROFEET_STORE_SLUGS;

export interface PrijsprofeetConfig {
  baseUrl: string;
  apiKey: string;
  /** Zet je naam erin: PrijsProfeet vraagt daarom en kan je dan bij een wijziging waarschuwen. */
  userAgent: string;
  isConfigured: boolean;
}

export interface PrijsprofeetAdapterOptions {
  /**
   * Levert "vandaag" in Europe/Amsterdam.
   *
   * Bestaat apart van de klok zodat tests niet van de echte datum afhangen:
   * anders zou een test over een paar dagen stilletjes een andere uitkomst
   * geven zonder dat er iets kapot is.
   */
  today?: () => string;
}

/** Ruwe rij zoals PrijsProfeet hem teruggeeft. Alleen de velden die we echt gebruiken. */
interface RawRow {
  product_id?: unknown;
  name?: unknown;
  brand?: unknown;
  ean?: unknown;
  quantity?: unknown;
  unit?: unknown;
  price?: unknown;
  original_price?: unknown;
  discount_percentage?: unknown;
  multi_buy_quantity?: unknown;
  multi_buy_price?: unknown;
  retailer?: unknown;
  is_promotional?: unknown;
  promotion_type?: unknown;
  promotion_status?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
  valid_until_estimated?: unknown;
  loyalty_price?: unknown;
  loyalty_program?: unknown;
  max_per_customer?: unknown;
  promotional_keywords?: unknown;
  product_url?: unknown;
}

interface RawPage {
  total?: unknown;
  page?: unknown;
  page_size?: unknown;
  products?: unknown;
  /** Zegt welke winkelfilters wél zijn toegepast. */
  retailer_filter?: { applied?: unknown; ignored?: unknown } | null;}

export class PrijsprofeetAdapter implements StoreAdapter {
  readonly storeId: StoreId;
  readonly storeName: string;
  readonly requirements: string[];
  readonly documentationUrl: string | null = PRIJSPROFEET_DOC_URL;

  private readonly config: PrijsprofeetConfig;
  private readonly retailerSlug: string;
  private readonly today: () => string;

  constructor(storeId: StoreId, config: PrijsprofeetConfig, options: PrijsprofeetAdapterOptions = {}) {
    this.storeId = storeId;
    this.storeName = storeNameFor(storeId);
    this.config = config;
    this.today = options.today ?? todayInAmsterdam;
    const slug = COVERED_STORES[storeId];
    if (!slug) {
      throw new Error(`PrijsProfeet levert geen data voor ${storeNameFor(storeId)}`);
    }
    this.retailerSlug = slug;
    this.requirements = [
      'Een gratis of betaalde API-sleutel van PrijsProfeet (prijsprofeet.nl/api).',
      'De sleutel in de omgevingsvariabele PRIJSPROFEET_API_KEY.',
      'Deze bron levert actieprijzen. Reguliere schapprijjzen en prijsverloop zijn onderdeel van het Pro-plan.',
      'Kruidvat levert PrijsProfeet niet; daar blijft de bron ongekoppeld.',
    ];
  }

  isConfigured(): boolean {
    return this.config.isConfigured;
  }

  describe(): AdapterHealth {
    if (!this.isConfigured()) {
      return {
        storeId: this.storeId,
        storeName: this.storeName,
        status: 'not_configured',
        message:
          `Er is nog geen bron aan ${this.storeName} gekoppeld. Zonder bron toont de app geen prijzen; ` +
          `er wordt niets verzonnen. Je kunt prijzen ook zelf invoeren via Importeren.`,
        requiredConfiguration: this.requirements,
        documentationUrl: this.documentationUrl,
        requiredEnvVars: ['PRIJSPROFEET_API_KEY'],
      };
    }
    return {
      storeId: this.storeId,
      storeName: this.storeName,
      status: 'connected',
      message: `Actieprijzen via PrijsProfeet. Prijzen zijn indicatief: controleer ze in de winkel.`,
      requiredConfiguration: this.requirements,
      documentationUrl: this.documentationUrl,
      requiredEnvVars: ['PRIJSPROFEET_API_KEY'],
    };
  }

  async fetchOffers(http: HttpClient): Promise<AdapterResult<AdapterOffer>> {
    const { rows, rejected } = await this.fetchRows(http);
    const items: AdapterOffer[] = [];

    for (const row of rows) {
      const offer = toOffer(row, this.storeId);
      if ('rejected' in offer) {
        rejected.push({ raw: offer.rejected.raw, reason: offer.rejected.reason });
        continue;
      }
      items.push(offer.offer);
    }

    return {
      items,
      rejected,
      sourceName: `PrijsProfeet (${this.storeName})`,
      fetchedAt: new Date().toISOString(),
    };
  }

  async fetchPrices(http: HttpClient): Promise<AdapterResult<AdapterPrice>> {
    const { rows, rejected } = await this.fetchRows(http);
    const items: AdapterPrice[] = [];

    for (const row of rows) {
      const offer = toOffer(row, this.storeId);
      if ('rejected' in offer) {
        rejected.push({ raw: offer.rejected.raw, reason: offer.rejected.reason });
        continue;
      }
      const { offer: o } = offer;
      items.push({
        storeProductId: o.storeProductId,
        title: o.title,
        regularPrice: o.regularPrice ?? o.offerPrice,
        offerPrice: o.offerPrice,
        conditions: o.conditions,
        kind: o.kind,
        gtin: o.gtin,
        packDescription: o.packDescription,
        packQuantity: o.packQuantity,
        packUnit: o.packUnit,
        inStock: true,
        observedAt: new Date().toISOString(),
        sourceName: `PrijsProfeet (${this.storeName})`,
      });
    }

    return {
      items,
      rejected,
      sourceName: `PrijsProfeet (${this.storeName})`,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Haalt alle pagina's van deze winkel op.
   *
   * De winkel wordt server-side gefilterd, dus de paginering levert alleen
   * rijen van deze ene winkel. Dat houdt het aantal verzoeken klein.
   */
  private async fetchRows(http: HttpClient): Promise<{
    rows: RawRow[];
    rejected: Array<{ raw: string; reason: string }>;
  }> {
    if (!this.config.isConfigured || !this.config.apiKey) {
      throw new SourceError({
        kind: 'geblokkeerd',
        message: `Geen PrijsProfeet-sleutel geconfigureerd.`,
        storeId: this.storeId,
        userMessage: `Er is geen PrijsProfeet-sleutel geconfigureerd.`,
      });
    }

    const today = this.today();
    const rows: RawRow[] = [];
    const rejected: Array<{ raw: string; reason: string }> = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url =
        `${this.config.baseUrl.replace(/\/+$/, '')}/products/promotional/all` +
        `?retailer=${encodeURIComponent(this.retailerSlug)}` +
        `&page=${page}&page_size=${PAGE_SIZE}`;

      const payload = await http.getJson<RawPage>(url, {
        storeId: this.storeId,
        label: `PrijsProfeet ${this.storeName} pagina ${page}`,
        headers: {
          'X-API-Key': this.config.apiKey,
          'User-Agent': this.config.userAgent,
        },
      });

      // Vang een genegeerd winkelfilter af. Geeft de bron een onbekende slug,
      // dan valt het filter stilzwijgend weg en krijg je ALLE winkels terug. Zou
      // je dat niet opvangen, dan belanden DekaMarkt-prijzen in Dirk.
      const filter = payload.retailer_filter;
      if (filter && !asStringArray(filter.applied).includes(this.retailerSlug)) {
        const ignored = asStringArray(filter.ignored).join(', ') || 'onbekend';
        throw new SourceError({
          kind: 'http',
          message: `PrijsProfeet negeerde het winkelfilter "${this.retailerSlug}" (genegeerd: ${ignored}).`,
          storeId: this.storeId,
          userMessage: `De prijsbron herkende ${this.storeName} niet en gaf andere winkels terug. Er zijn geen prijzen opgeslagen.`,
        });
      }

      const products = Array.isArray(payload.products) ? (payload.products as RawRow[]) : [];
      for (const row of products) {
        const verdict = checkSellableToday(row, today);
        if (verdict !== null) {
          rejected.push({ raw: labelOf(row), reason: verdict });
          continue;
        }
        rows.push(row);
      }

      const total = typeof payload.total === 'number' ? payload.total : 0;
      if (products.length === 0 || rows.length + rejected.length >= total) break;
    }

    return { rows, rejected };
  }
}

// ---------------------------------------------------------------------------
// Rijen omzetten naar het app-contract
// ---------------------------------------------------------------------------

type Converted =
  | { offer: AdapterOffer }
  | { rejected: { raw: string; reason: string } };

function toOffer(row: RawRow, storeId: StoreId): Converted {
  const raw = labelOf(row);
  const title = typeof row.name === 'string' ? row.name.trim() : '';
  if (!title) return { rejected: { raw, reason: 'Geen productnaam' } };

  // `price` is de prijs per stuk en is altijd de prijs die iemand zonder
  // klantenkaart betaalt. Een ledenprijs staat apart in `loyalty_price` en
  // wordt nooit als gewone prijs behandeld.
  if (!isValidPrice(row.price)) {
    return { rejected: { raw, reason: 'Ongeldige of ontbrekende prijs' } };
  }
  const offerPrice = row.price as number;

  const regularPrice = isValidPrice(row.original_price) ? (row.original_price as number) : null;
  if (row.original_price !== null && row.original_price !== undefined && regularPrice === null) {
    return { rejected: { raw, reason: 'Ongeldige van-voor-prijs' } };
  }

  const conditions: AdapterOffer['conditions'] = {};

  // Bundel: "3 voor €0,89" en "2+2 gratis" (dan 4 voor €1,28). De kern rekent
  // hiermee uit dat je het hele pakket moet nemen om één stuk te krijgen.
  const bundleSize = finiteOrNull(row.multi_buy_quantity);
  const bundlePrice = finiteOrNull(row.multi_buy_price);
  const isBundle = bundleSize !== null && bundlePrice !== null && bundleSize > 1;
  if (isBundle) {
    conditions.bundleSize = bundleSize;
    conditions.bundlePrice = bundlePrice;
  }

  const discount = finiteOrNull(row.discount_percentage);
  if (discount !== null && discount > 0 && discount <= 100) {
    conditions.discountPercent = discount;
  }

  const maxPer = finiteOrNull(row.max_per_customer);
  if (maxPer !== null && maxPer > 0) {
    conditions.maxPerPerson = maxPer;
  }

  const kind: OfferKind = isBundle ? 'multipack' : 'price_drop';

  const brand = typeof row.brand === 'string' ? row.brand.trim() : '';
  const pack = parsePack(row.quantity, row.unit);

  // Beschrijving: merk, en een eerlijke aanvulling zodat niets verloren gaat.
  const notes: string[] = [];
  if (brand) notes.push(brand);
  if (row.valid_until_estimated === true) {
    notes.push('einddatum geschat door de bron');
  }
  const loyalty = finiteOrNull(row.loyalty_price);
  if (loyalty !== null && loyalty > 0) {
    // Ons contract kent nog geen "goedkoper met kaart". Het weggooien zou een
    // lagere prijs verzwijgen, dus het staat in de beschrijving.
    const program = typeof row.loyalty_program === 'string' ? row.loyalty_program : 'klantenkaart';
    notes.push(`${program}: €${loyalty.toFixed(2).replace('.', ',')}`);
  }
  const keywords = Array.isArray(row.promotional_keywords)
    ? row.promotional_keywords.filter((k): k is string => typeof k === 'string')
    : [];
  if (keywords.length > 0) notes.push(keywords.join(' '));

  return {
    offer: {
      storeProductId: typeof row.product_id === 'string' && row.product_id ? row.product_id : `${storeId}-${raw}`,
      title,
      description: notes.length > 0 ? notes.join(' · ') : null,
      kind,
      offerPrice,
      regularPrice,
      conditions,
      validFrom: dateOrNull(row.valid_from),
      validUntil: dateOrNull(row.valid_until),
      packDescription: pack.description,
      gtin: normalizeGtin(row.ean),
      packQuantity: pack.quantity,
      packUnit: pack.unit,
    },
  };
}

/**
 * Mag deze actie vandaag gekocht worden?
 *
 * Geeft `null` als het mag, anders de reden waarom niet. Acties die pas later
 * beginnen of al verlopen zijn, worden geweigerd: die prijs bestaat vandaag
 * niet op het schap.
 */
function checkSellableToday(row: RawRow, today: string): string | null {
  if (row.is_promotional === false) {
    return 'Geen promotie; reguliere prijzen vragen het Pro-plan';
  }
  const status = typeof row.promotion_status === 'string' ? row.promotion_status : null;
  if (status === 'historical') return 'Verleden actie, geen actuele prijs';
  if (status === 'shelf') return 'Reguliere schapprijs; acties vragen het Pro-plan';

  const from = dateOrNull(row.valid_from);
  const until = dateOrNull(row.valid_until);
  if (from && from > today) {
    return `Actie begint pas op ${from}; vandaag nog niet te kopen`;
  }
  if (until && until < today) {
    return `Actie is verlopen op ${until}`;
  }
  if (status === 'upcoming' && (!from || from <= today)) {
    // Zonder bruikbare startdatum is niet vast te stellen dat dit vandaag
    // geldt, dus niet tonen.
    return 'Status "upcoming" zonder geldige startdatum; niet als actie van vandaag te verifiëren';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kleine hulpfuncties
// ---------------------------------------------------------------------------

function labelOf(row: RawRow): string {
  if (typeof row.name === 'string' && row.name.trim()) return row.name.trim();
  if (typeof row.product_id === 'string' && row.product_id) return row.product_id;
  return 'onbekend product';
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Lijst van strings uit een onbekend veld; alles wat geen string is valt weg. */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/** EAN/GTIN: 8, 12, 13 of 14 cijfers. Retourneert null als het er geen is. */
function normalizeGtin(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const digits = String(value).replace(/\D/g, '');
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

/**
 * Leest de verpakking uit het `quantity`-veld.
 *
 * `quantity` is de inhoud ("100 g", "2 x 250 ml", "per stuk"); `unit` is de
 * vergelijkingsseenheid ("kg") en wordt bewust genegeerd als verpakking.
 */
function parsePack(
  quantity: unknown,
  unit: unknown,
): { description: string | null; quantity: number | null; unit: string | null } {
  if (typeof quantity !== 'string') {
    return { description: null, quantity: null, unit: null };
  }
  const text = quantity.trim();
  if (text.length === 0) return { description: null, quantity: null, unit: null };

  // "per stuk" en varianten daarop: één exemplaar, geen maat.
  if (/^per\b/i.test(text)) {
    return { description: text, quantity: 1, unit: 'stuk' };
  }

  // Meerdere verpakkingen in één product, bv. "2 x 250 ml".
  const multi = /^(\d+)\s*x\s*([\d.,]+)\s*([a-zA-Zµ]+)$/.exec(text);
  if (multi) {
    const packs = Number(multi[1] ?? 0);
    const size = Number((multi[2] ?? '').replace(',', '.'));
    const unitName = normalizeUnit(multi[3]);
    if (Number.isFinite(packs) && Number.isFinite(size) && packs > 0 && size > 0) {
      return {
        description: text,
        quantity: round2(packs * size),
        unit: unitName,
      };
    }
  }

  const single = /^([\d.,]+)\s*([a-zA-Zµ]*)$/.exec(text);
  if (single) {
    const size = Number((single[1] ?? '').replace(',', '.'));
    if (Number.isFinite(size) && size > 0) {
      return { description: text, quantity: round2(size), unit: normalizeUnit(single[2]) };
    }
  }

  // Onleesbaar, maar wel bruikbaar als beschrijving. Het aantal blijft null, zodat
  // het product niet op een schijnbaar nauwkeurig volume wordt beoordeeld.
  return { description: text, quantity: null, unit: null };
}

function normalizeUnit(value: string | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  if (key === 'l') return 'l';
  if (key === 'kg') return 'kg';
  if (key === 'g' || key === 'gr') return 'g';
  if (key === 'ml') return 'ml';
  if (key === 'cl') return 'cl';
  if (key === 'stuk' || key === 'st') return 'stuk';
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Vandaag in Europe/Amsterdam, zodat de datum klopt vlak na middernacht. */
function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
