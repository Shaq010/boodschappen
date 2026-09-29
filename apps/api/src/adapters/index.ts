/**
 * Adapterregister.
 *
 * Hier wordt per winkel de juiste adapter gekozen. Elke winkelspecifieke
 * adapter erft van GenericFeedAdapter, zodat er één plek is die weet hoe een
 * bron wordt opgeroepen en gevalideerd.
 *
 * Waarom er geen aparte "Lidl-scraper" is:
 * Lidl, Albert Heijn, Dirk en Kruidvat bieden geen openbare API voor prijzen
 * en aanbiedingen, en hun websites verbieden geautomatiseerd ophalen. In
 * plaats van dat te omzeilen, vraagt deze app om een officiële koppeling via
 * omgevingsvariabelen en toont zij expliciet wat er ontbreekt. Prijzen worden
 * nooit geschat of verzonnen.
 *
 * Wilt je één winkel met een eigen feed-formaat? Maak dan een adapter die
 * `StoreAdapter` implementeert en registreer die hieronder; de rest van de app
 * hoeft niet te veranderen.
 */

import type { StoreId } from '@boodschappen/core';
import { type AppConfig, PRIJSPROFEET_STORE_SLUGS, sourceForStore, type SourceConfig } from '../config.js';
import { GenericFeedAdapter, type GenericFeedAdapterOptions } from './generic-feed.js';
import { PrijsprofeetAdapter } from './prijsprofeet.js';
import type { AdapterHealth, StoreAdapter } from './types.js';
import { storeNameFor } from './types.js';

/** Winkelspecifieke aanpassingen aan het feed-contract. */
const FEED_OPTIONS: Record<StoreId, Omit<GenericFeedAdapterOptions, 'storeId' | 'storeName' | 'source'>> = {
  lidl: {
    // Lidl-deals zijn vaak per week geldig en in multipackvorm.
    offersPath: '/offers',
    pricesPath: '/prices',
  },
  albert_heijn: {
    offersPath: '/offers',
    pricesPath: '/prices',
  },
  dirk: {
    offersPath: '/offers',
    pricesPath: '/prices',
  },
  kruidvat: {
    // Kruidvat is een drogist: veel kortingen zijn loyaliteits- of
    // per-volumeacties. De veldnamen blijven hetzelfde; de
    // `conditions.requiresLoyaltyCard` en `conditions.discountPercent`-velden
    // worden door de interface onderscheiden.
    offersPath: '/offers',
    pricesPath: '/prices',
  },
};

export class AdapterRegistry {
  private readonly adapters: Map<StoreId, StoreAdapter>;

  constructor(config: AppConfig) {
    this.adapters = new Map();
    for (const storeId of Object.keys(FEED_OPTIONS) as StoreId[]) {
      const source = sourceForStore(config, storeId);

      // Voorrang voor een eigen winkelkoppeling. Pas als die er niet is, valt de
      // winkel terug op PrijsProfeet: één sleutel, drie winkels, per winkel
      // gefilterd opgehaald zodat de key niet drie keer wordt belast.
      if (source?.isConfigured) {
        this.adapters.set(
          storeId,
          new GenericFeedAdapter({
            storeId,
            storeName: storeNameFor(storeId),
            source,
            ...FEED_OPTIONS[storeId],
          }),
        );
        continue;
      }

      if (config.prijsprofeet.isConfigured && PRIJSPROFEET_STORE_SLUGS[storeId]) {
        this.adapters.set(storeId, new PrijsprofeetAdapter(storeId, config.prijsprofeet));
        continue;
      }

      // Nog niets gekoppeld. Toch een adapter bouwen zodat de statuspagina kan
      // uitleggen wat er ontbreekt, in plaats van de winkel weg te laten.
      this.adapters.set(
        storeId,
        new GenericFeedAdapter({
          storeId,
          storeName: storeNameFor(storeId),
          source: source ?? { ...emptySource(storeId) },
          ...FEED_OPTIONS[storeId],
        }),
      );
    }
  }

  get(storeId: StoreId): StoreAdapter {
    const adapter = this.adapters.get(storeId);
    if (!adapter) {
      throw new Error(`Geen adapter geregistreerd voor winkel ${storeId}`);
    }
    return adapter;
  }

  all(): StoreAdapter[] {
    return [...this.adapters.values()];
  }

  /** Status van alle winkels, in de vaste volgorde van STORE_IDS. */
  describeAll(): AdapterHealth[] {
    return [...this.adapters.values()].map((adapter) => adapter.describe());
  }

  configuredStoreIds(): StoreId[] {
    return [...this.adapters.values()]
      .filter((adapter) => adapter.isConfigured())
      .map((adapter) => adapter.storeId);
  }
}

export { GenericFeedAdapter };
export * from './types.js';

/** Bron zonder inhoud, voor winkels waar nog niets is ingesteld. */
function emptySource(storeId: StoreId): SourceConfig {
  return {
    storeId,
    provider: 'GEEN',
    label: storeNameFor(storeId),
    baseUrl: '',
    apiKey: '',
    headers: {},
    documentationUrl: null,
    ttlSeconds: 0,
    isConfigured: false,
  };
}
