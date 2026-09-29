/**
 * Synchronisatie van winkels met de gekoppelde databronnen.
 *
 * Verloop per winkel:
 *  1. Status vastleggen (`syncing`) en de vorige cache ongeldig maken.
 *  2. Aanbiedingen ophalen via de adapter.
 *  3. Elk artikel koppelen aan een intern product (GTIN of naam, anders nieuw).
 *  4. Aanbieding, prijs en prijsgeschiedenis opslaan.
 *  5. Status bijwerken: geslaagd, mislukt of niet gekoppeld.
 *
 * Belangrijk: bij een fout of een ontbrekende koppeling worden bestaande
 * gegevens NIET gewist. Je verliest dus nooit je historie door een storing.
 */

import { STORE_IDS, type StoreId } from '@boodschappen/core';
import { type AppConfig, sourceForStore } from '../config.js';
import { type Database_ } from '../db/client.js';
import { dataSources, offers, priceHistory, prices, storeProducts } from '../db/schema.js';
import { AdapterRegistry } from '../adapters/index.js';
import type { AdapterHealth, AdapterOffer, AdapterPrice, AdapterResult, StoreAdapter } from '../adapters/types.js';
import { SourceError, type HttpClient } from '../services/http.js';
import { CacheKeys, type TtlCache } from '../services/cache.js';
import { ProductResolver } from './products.js';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export type SourceState = AdapterHealth['status'];

export interface StoreStatus {
  storeId: StoreId;
  storeName: string;
  status: SourceState;
  message: string;
  offerCount: number;
  priceCount: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  ageSeconds: number | null;
  documentationUrl: string | null;
  requiredEnvVars: string[];
  requiredConfiguration: string[];
}

export interface SyncOutcome {
  storeId: StoreId;
  status: SourceState;
  message: string;
  offersStored: number;
  pricesStored: number;
  rejected: Array<{ raw: string; reason: string }>;
}

export interface SyncDeps {
  config: AppConfig;
  db: Database_;
  http: HttpClient;
  cache: TtlCache;
  registry: AdapterRegistry;
  now?: () => Date;
}

function toCents(euros: number): number {
  return Math.round(euros * 100);
}

export class SyncService {
  private readonly now: () => Date;
  readonly products: ProductResolver;
  /** Waar er een achtergrondsync bezig is; voorkomt dubbele runs. */
  private running = false;
  /** De lopende achtergrondsync, zodat je erop kunt wachten (tests, planner). */
  private current: Promise<SyncOutcome[]> | null = null;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => new Date());
    this.products = new ProductResolver(deps.db);
  }

  /** Status van alle winkels, met aantallen uit de database. */
  statuses(): StoreStatus[] {
    const { db, cache, registry, config } = this.deps;

    return STORE_IDS.map((storeId) => {
      const adapter: StoreAdapter = registry.get(storeId);
      const health = adapter.describe();
      const source = sourceForStore(config, storeId);
      const record = source
        ? db.select().from(dataSources).where(eq(dataSources.storeId, storeId)).get()
        : undefined;

      const offerCount =
        db.select({ n: sql<number>`count(*)` }).from(offers).where(eq(offers.storeId, storeId)).get()?.n ?? 0;
      const priceCount =
        db.select({ n: sql<number>`count(*)` }).from(prices).where(eq(prices.storeId, storeId)).get()?.n ?? 0;

      return {
        storeId,
        storeName: health.storeName,
        status: this.resolveStatus(health.status, record?.status ?? null, cache.ageSeconds(CacheKeys.offers(storeId))),
        message: health.message,
        offerCount,
        priceCount,
        lastSuccessAt: record?.lastSuccessAt ?? null,
        lastAttemptAt: record?.lastAttemptAt ?? null,
        lastError: record?.lastError ?? null,
        ageSeconds: cache.ageSeconds(CacheKeys.offers(storeId)),
        documentationUrl: health.documentationUrl,
        requiredEnvVars: health.requiredEnvVars,
        requiredConfiguration: health.requiredConfiguration,
      };
    });
  }

  /**
   * Een verse cache betekent: we hebben nu betrouwbare gegevens. Een
   * ongeconfigureerde bron blijft altijd `not_configured`, hoe oud de data ook is.
   */
  private resolveStatus(health: SourceState, stored: string | null, cacheAge: number | null): SourceState {
    if (health === 'not_configured') return 'not_configured';
    if (cacheAge !== null) return 'connected';
    if (stored === 'network_disabled') return 'network_disabled';
    if (stored === 'error' || stored === 'rate_limited') return stored;
    if (stored === 'syncing') return 'syncing';
    return health;
  }

  /** Haalt één winkel op. Geeft nooit een fout boven; fouten worden status. */
  async syncStore(storeId: StoreId): Promise<SyncOutcome> {
    const { http, cache, registry, config } = this.deps;
    const adapter = registry.get(storeId);
    const source = sourceForStore(config, storeId);
    const storeName = adapter.storeName;
    const nowIso = this.now().toISOString();
    const writeStatus = this.sourceWriter(storeId, nowIso);

    if (!adapter.isConfigured() || !source) {
      writeStatus('not_configured', null);
      return {
        storeId,
        status: 'not_configured',
        message:
          `Er is geen officiële databron aan ${storeName} gekoppeld, dus er worden geen prijzen opgehaald. ` +
          `Koppel een geautoriseerde bron of voer prijzen zelf in via Importeren.`,
        offersStored: 0,
        pricesStored: 0,
        rejected: [],
      };
    }

    writeStatus('syncing', null);

    try {
      const offerResult = await adapter.fetchOffers(http);
      const offersStored = this.storeOffers(storeId, storeName, offerResult.items, offerResult.sourceName, source.provider);

      // Prijzen zijn optioneel: veel bronnen leveren alleen acties.
      let pricesStored = 0;
      const priceRejected: Array<{ raw: string; reason: string }> = [];
      try {
        const priceResult = await adapter.fetchPrices(http);
        pricesStored = this.storePrices(storeId, priceResult.items, source.provider);
        priceRejected.push(...priceResult.rejected);
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        // Geen prijzen is geen ramp: de aanbiedingen zijn belangrijker.
      }

      const rejected = [...offerResult.rejected, ...priceRejected];
      cache.set(CacheKeys.offers(storeId), offerResult, source.ttlSeconds);
      writeStatus('connected', null, { offers: offerResult.items.length, prices: pricesStored });

      return {
        storeId,
        status: 'connected',
        message:
          rejected.length > 0
            ? `${offersStored} aanbiedingen opgehaald uit "${offerResult.sourceName}". ` +
              `${rejected.length} regel(s) zijn geweigerd omdat de gegevens onvolledig of ongeldig waren.`
            : `${offersStored} aanbiedingen opgehaald uit "${offerResult.sourceName}".`,
        offersStored,
        pricesStored,
        rejected,
      };
    } catch (error) {
      const failure =
        error instanceof SourceError
          ? error
          : new SourceError({ kind: 'onbekend', message: String(error), storeId });

      // Oude gegevens blijven staan; alleen de status verandert.
      // Een bewust uitgezet netwerk is geen fout, maar een stand van zaken.
      const status: SourceState =
        failure.kind === 'rate_limit'
          ? 'rate_limited'
          : failure.kind === 'geblokkeerd'
            ? 'network_disabled'
            : 'error';
      writeStatus(status, failure.userMessage);
      cache.delete(CacheKeys.offers(storeId));

      return {
        storeId,
        status,
        message: failure.userMessage,
        offersStored: 0,
        pricesStored: 0,
        rejected: [],
      };
    }
  }

  /** Haalt alle winkels op; één falende winkel stopt de rest niet op. */
  async syncAll(): Promise<SyncOutcome[]> {
    const outcomes: SyncOutcome[] = [];
    for (const storeId of STORE_IDS) {
      outcomes.push(await this.syncStore(storeId));
    }
    return outcomes;
  }

  /**
   * Start een sync op de achtergrond en wacht er niet op.
   *
   * Waarom: een volledige run over drie winkels duurt ruim twee minuten. Een
   * HTTP-verzoek dat daarop wacht loopt tegen de time-out van de host
   * (bij Railway 100 seconden) en de gebruiker ziet alleen een mislukteknop.
   * Daarom wordt het werk losgekoppeld; de voortgang is te volgen via
   * `statuses()`, dat tijdens de run `syncing` laat zien.
   *
   * Twee clicks tegelijk zouden twee runs op dezelfde rijen starten, dus een
   * tweede verzoek wordt geweigerd zolang de eerste loopt.
   *
   * Geeft `null` terug als er al een sync bezig is.
   */
  startInBackground(target: { storeId?: StoreId } = {}): Promise<SyncOutcome[]> | null {
    if (this.current) return null;
    this.running = true;

    const run = async (): Promise<SyncOutcome[]> => {
      try {
        return target.storeId ? [await this.syncStore(target.storeId)] : await this.syncAll();
      } finally {
        this.running = false;
        this.current = null;
      }
    };

    // Bewust niet awaited: de caller wil meteen antwoord geven. De afhandeling
    // schrijft zijn status naar de database, dus een mislukking blijft zichtbaar.
    this.current = run();
    this.current.catch(() => {
      /* syncStore vangt zijn eigen fouten; dit vangt een onverwachte afwijking */
    });
    return this.current;
  }

  /** Loopt er nu een sync op de achtergrond? */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Wacht tot de lopende achtergrondsync klaar is; doet niets als er geen is.
   *
   * Bestaat zodat een test kan wachten op het resultaat, en zodat een latere
   * periodieke sync netjes kan afsluiten.
   */
  async waitForBackgroundSync(): Promise<void> {
    await this.current?.catch(() => undefined);
  }

  /**
   * Houdt de prijzen vanzelf bij: één keer na het opstarten en daarna elke
   * `intervalMs`.
   *
   * Waarom: de app hoeft geen knop meer te tonen. Prijzen veranderen per dag,
   * en een server die urenlang draait zou anders een dag oude prijzen tonen.
   * Met deze timer hoeft niemand eraan te denken.
   *
   * Geeft een stopfunctie terug, zodat tests en het afsluiten van de server de
   * timer weer uitzetten.
   */
  startBackgroundScheduler(intervalMs = 6 * 60 * 60 * 1000): () => void {
    const run = (): void => {
      // Geen netwerk aan? Dan is er niets te halen; de bronstatus zegt dan al
      // waarom het niet werkt.
      if (!this.deps.config.sync.allowNetwork) return;
      // Loopt er al een run? Dan slaan we deze ronde over; die loopt immers
      // al de verse gegevens binnen.
      this.startInBackground();
    };

    // Even wachten na het opstarten, zodat de server eerst bereikbaar is.
    const first = setTimeout(run, 10_000);
    const timer = setInterval(run, intervalMs);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }

  /**
   * Zet een winkel op `syncing`, zodat de interface ziet dat er gewerkt wordt.
   *
   * Gebruikt door de achtergrondsync: het ophalen duurt minuten en de
   * gebruiker moet in die tijd niet denken dat hij de laatste prijzen ziet.
   */
  markSyncing(storeId: StoreId): void {
    this.sourceWriter(storeId, this.now().toISOString())('syncing', null);
  }

  /** Schrijft de status van een bron weg; maakt het record aan als het ontbreekt. */
  private sourceWriter(storeId: StoreId, nowIso: string) {
    const { db, config } = this.deps;
    const source = sourceForStore(config, storeId);
    if (!source) return () => {};

    return (
      status: SourceState,
      error: string | null,
      counts?: { offers: number; prices: number },
    ): void => {
      const existing = db
        .select()
        .from(dataSources)
        .where(and(eq(dataSources.storeId, storeId), eq(dataSources.provider, source.provider)))
        .get();

      if (existing) {
        db.update(dataSources)
          .set({
            status,
            lastAttemptAt: nowIso,
            lastSuccessAt: status === 'connected' ? nowIso : existing.lastSuccessAt,
            lastError: error,
            offersImported: counts?.offers ?? existing.offersImported,
            pricesImported: counts?.prices ?? existing.pricesImported,
            updatedAt: nowIso,
          })
          .where(eq(dataSources.id, existing.id))
          .run();
        return;
      }

      db.insert(dataSources)
        .values({
          id: randomUUID(),
          storeId,
          provider: source.provider,
          label: source.label,
          status,
          documentationUrl: source.documentationUrl,
          lastAttemptAt: nowIso,
          lastSuccessAt: status === 'connected' ? nowIso : null,
          lastError: error,
          offersImported: counts?.offers ?? 0,
          pricesImported: counts?.prices ?? 0,
          updatedAt: nowIso,
        })
        .run();
    };
  }

  private storeOffers(
    storeId: StoreId,
    storeName: string,
    items: AdapterOffer[],
    sourceName: string,
    provider: string,
  ): number {
    const { db } = this.deps;
    const nowIso = this.now().toISOString();
    const sourceId = this.sourceIdFor(storeId, provider);

    db.transaction(() => {
      // Een geslaagde sync is een momentopname: de set aanbiedingen van deze
      // winkel is precies wat de bron nu teruggeeft. Zonder deze stap zou elke
      // sync dezelfde aanbiedingen opnieuw toevoegen, waardoor ze na een paar
      // dagen dubbel op het scherm staan en de besparing dubbel wordt geteld.
      // Aanbiedingen die uit de feed verdwijnen verdwijnen hiermee ook; het
      // product zelf en de prijsgeschiedenis blijven staan.
      db.delete(offers).where(eq(offers.storeId, storeId)).run();

      for (const item of items) {
        const resolved = this.products.resolve({
          name: item.title,
          gtin: item.gtin,
          storeId,
          storeProductId: item.storeProductId,
          packDescription: item.packDescription,
        });

        const link = this.storeProductRow(storeId, item.storeProductId);
        if (!link) continue;

        db.insert(offers)
          .values({
            id: randomUUID(),
            storeId,
            storeProductId: link.id,
            productId: resolved.productId,
            title: item.title,
            description: item.description,
            kind: item.kind,
            conditions: item.conditions,
            offerPriceCents: toCents(item.offerPrice),
            regularPriceCents: item.regularPrice ? toCents(item.regularPrice) : null,
            currency: 'EUR',
            validFrom: item.validFrom,
            validUntil: item.validUntil,
            storeName,
            packDescription: item.packDescription,
            sourceId,
            sourceName,
            updatedAt: nowIso,
          })
          .run();

        // Meerdere aanbiedingen voor hetzelfde artikel in één keer is
        // normaal (bv. 2 voor 3 en 25% korting); daarom een unieke sleutel.
        const existingHistory = db
          .select({ id: priceHistory.id })
          .from(priceHistory)
          .where(
            and(
              eq(priceHistory.storeProductId, link.id),
              eq(priceHistory.priceDate, nowIso.slice(0, 10)),
              eq(priceHistory.offerPriceCents, toCents(item.offerPrice)),
            ),
          )
          .get();
        if (existingHistory) continue;

        db.insert(priceHistory)
          .values({
            id: randomUUID(),
            storeId,
            storeProductId: link.id,
            productId: resolved.productId,
            regularPriceCents: item.regularPrice ? toCents(item.regularPrice) : null,
            offerPriceCents: toCents(item.offerPrice),
            isOffer: true,
            currency: 'EUR',
            priceDate: nowIso.slice(0, 10),
            sourceId,
          })
          .run();
      }
    });

    return items.length;
  }

  private storePrices(storeId: StoreId, items: AdapterPrice[], provider: string): number {
    const { db } = this.deps;
    const nowIso = this.now().toISOString();
    const sourceId = this.sourceIdFor(storeId, provider);

    db.transaction(() => {
      for (const item of items) {
        const resolved = this.products.resolve({
          name: item.title,
          gtin: item.gtin,
          storeId,
          storeProductId: item.storeProductId,
          packDescription: item.packDescription,
        });

        const link = this.storeProductRow(storeId, item.storeProductId);
        if (!link) continue;

        const offerPriceCents = item.offerPrice ? toCents(item.offerPrice) : null;
        const regularPriceCents = toCents(item.regularPrice);

        // Eén prijs per artikel per winkel: de laatste waarde wint.
        const existing = db
          .select({ id: prices.id })
          .from(prices)
          .where(and(eq(prices.storeProductId, link.id), eq(prices.storeId, storeId)))
          .get();

        if (existing) {
          db.update(prices)
            .set({
              regularPriceCents,
              offerPriceCents,
              inStock: item.inStock ?? true,
              packQuantity: item.packQuantity ?? null,
              packUnit: item.packUnit ?? null,
              observedAt: item.observedAt ?? nowIso,
              sourceId,
            })
            .where(eq(prices.id, existing.id))
            .run();
        } else {
          db.insert(prices)
            .values({
              id: randomUUID(),
              storeId,
              storeProductId: link.id,
              productId: resolved.productId,
              regularPriceCents,
              offerPriceCents,
              currency: 'EUR',
              inStock: item.inStock ?? true,
              packQuantity: item.packQuantity ?? null,
              packUnit: item.packUnit ?? null,
              observedAt: item.observedAt ?? nowIso,
              sourceId,
            })
            .run();
        }

        const historyExists = db
          .select({ id: priceHistory.id })
          .from(priceHistory)
          .where(
            and(
              eq(priceHistory.storeProductId, link.id),
              eq(priceHistory.priceDate, nowIso.slice(0, 10)),
              eq(priceHistory.regularPriceCents, regularPriceCents),
            ),
          )
          .get();
        if (historyExists) continue;

        db.insert(priceHistory)
          .values({
            id: randomUUID(),
            storeId,
            storeProductId: link.id,
            productId: resolved.productId,
            regularPriceCents,
            offerPriceCents,
            isOffer: offerPriceCents !== null,
            currency: 'EUR',
            priceDate: nowIso.slice(0, 10),
            sourceId,
          })
          .run();
      }
    });

    return items.length;
  }

  private sourceIdFor(storeId: StoreId, provider: string): string | null {
    const { db } = this.deps;
    const record = db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(and(eq(dataSources.storeId, storeId), eq(dataSources.provider, provider)))
      .get();
    return record?.id ?? null;
  }

  private storeProductRow(storeId: StoreId, storeProductId: string): { id: string } | undefined {
    const { db } = this.deps;
    return db
      .select({ id: storeProducts.id })
      .from(storeProducts)
      .where(and(eq(storeProducts.storeId, storeId), eq(storeProducts.storeProductId, storeProductId)))
      .get();
  }
}
