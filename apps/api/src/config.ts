/**
 * Runtime-configuratie.
 *
 * REGEL: geheimen komen ALLEEN uit de omgeving en blijven in dit proces.
 * `publicConfig()` geeft uitsluitend niet-geheime waarden terug; dat is het
 * enige dat naar de frontend gaat. Er is geen enkele codeweg waarmee een
 * API-key in een API-response terecht kan komen.
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_IDS, type StoreId } from '@boodschappen/core';

export interface AppConfig {
  server: {
    host: string;
    port: number;
    /** Prefix voor alle API-routes. */
    apiPrefix: string;
    /** Staat CORS open; in productie zet je dit op je eigen domein. */
    corsOrigin: string;
    logLevel: string;
  };
  database: {
    /** Pad naar het SQLite-bestand. */
    file: string;
  };
  cache: {
    /** Standaard levensduur van een cache-entry in seconden. */
    defaultTtlSeconds: number;
    /** Maximale hoeveelheid entries in het geheugen. */
    maxEntries: number;
  };
  sync: {
    /** Zet op false om alle uitgaande verzoeken te blokkeren (offline/test). */
    allowNetwork: boolean;
    /** Time-out voor uitgaande verzoeken in milliseconden. */
    requestTimeoutMs: number;
    /** Aantal pogingen bij een tijdelijke fout. */
    maxRetries: number;
    /** Wachttijd tussen pogoten in milliseconden. */
    retryDelayMs: number;
  };
  /**
   * Databronnen per winkel. De sleutel is de technische bronnaam; de waarde
   * bevat het endpoint en de sleutel. NIET naar de client sturen.
   */
  sources: Record<string, SourceConfig>;
  /**
   * PrijsProfeet: één officiële prijsbron met één sleutel voor meerdere
   * winkels. Bestaat naast `sources`, omdat de per-winkel-bronnen elk een eigen
   * endpoint en sleutel verwachten en PrijsProfeet juist één sleutel voor
   * Lidl, Albert Heijn en Dirk deelt. NIET naar de client sturen.
   */
  prijsprofeet: {
    baseUrl: string;
    apiKey: string;
    userAgent: string;
    isConfigured: boolean;
  };
  /** Productinformatie van Open Food Facts (open, zonder sleutel). */
  openFoodFacts: {
    enabled: boolean;
    baseUrl: string;
    userAgent: string;
  };
  defaultUser: {
    id: string;
    displayName: string;
  };
}

export interface SourceConfig {
  storeId: StoreId;
  provider: string;
  /** Naam die de gebruiker herkent. */
  label: string;
  /** Basis-URL van de bron. */
  baseUrl: string;
  /** Bearer-token of API-key. Geheim. */
  apiKey: string;
  /** Optionele extra headers. Geheim. */
  headers: Record<string, string>;
  documentationUrl: string | null;
  /** Levensduur van de aanbiedingen in de cache, in seconden. */
  ttlSeconds: number;
  /** Deze bron is actief als er een sleutel of endpoint is ingevuld. */
  isConfigured: boolean;
}

function env(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'ja', 'yes', 'on'].includes(value.toLowerCase());
}

function envInt(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * De map van de monorepo, bepaald vanaf de plek van dit bestand in plaats van
 * vanaf de huidige werkmap.
 *
 * Waarom dit nodig is: `npm run -w @boodschappen/api` start het proces met de
 * map `apps/api` als werkmap. Een relatief pad als `./data/app.db` zou dan in
 * `apps/api/data` landen, terwijl een handmatige start vanaf de projectroot
 * weer `data/` gebruikt. Dat levert twee verschillende databases op voor
 * precies dezelfde app. Door het pad aan deze module te hangen maakt de
 * werkmap niet meer uit.
 *
 * `src/` en `dist/` liggen even diep, dus dit werkt voor dev én voor de build.
 */
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Zet een relatief databasepad altijd onder de projectroot. */
function resolveFromProjectRoot(file: string): string {
  return isAbsolute(file) ? file : resolve(projectRoot, file);
}

function readSource(
  storeId: StoreId,
  slug: string,
  label: string,
  documentationUrl: string | null,
): SourceConfig {
  const baseUrl = env(`SOURCE_${slug}_BASE_URL`);
  const apiKey = env(`SOURCE_${slug}_API_KEY`);
  // Extra headers, bv. "X-Api-Key: abc, X-Tenant: boodschappen"
  const rawHeaders = env(`SOURCE_${slug}_HEADERS`);
  const headers: Record<string, string> = {};
  if (rawHeaders) {
    for (const pair of rawHeaders.split(',')) {
      const [name, ...rest] = pair.split(':');
      if (name && rest.length > 0) headers[name.trim()] = rest.join(':').trim();
    }
  }
  return {
    storeId,
    provider: slug,
    label,
    baseUrl,
    apiKey,
    headers,
    documentationUrl,
    ttlSeconds: envInt(`SOURCE_${slug}_TTL_SECONDS`, 6 * 3600),
    isConfigured: baseUrl.length > 0,
  };
}

/**
 * Technische namen van de bronnen. Deze zijn GEEN scraping-implementaties:
 * elk van deze namen verwijst naar een officiële, geautoriseerde koppeling
 * waarvoor je een abonnement of een afspraak nodig hebt.
 */
export const SOURCE_SLUGS: Record<StoreId, string> = {
  lidl: 'LIDL',
  albert_heijn: 'ALBERT_HEIJN',
  dirk: 'DIRK',
  kruidvat: 'KRUIDVAT',
};

export function loadConfig(): AppConfig {
  const sources: Record<string, SourceConfig> = {};
  for (const storeId of STORE_IDS) {
    const slug = SOURCE_SLUGS[storeId];
    const config = readSource(storeId, slug, storeLabel(storeId), null);
    sources[slug] = config;
  }

  // Eén sleutel voor meerdere winkels. De basis-URL heeft een waarde, dus de
  // bron is actief zodra er een sleutel is; zonder sleutel blijft hij af.
  const prijsprofeetBaseUrl = env('PRIJSPROFEET_BASE_URL', 'https://www.prijsprofeet.nl/api/v1');
  const prijsprofeetKey = env('PRIJSPROFEET_API_KEY');

  return {
    server: {
      host: env('HOST', '0.0.0.0'),
      port: envInt('PORT', 4000),
      apiPrefix: env('API_PREFIX', '/api'),
      corsOrigin: env('CORS_ORIGIN', '*'),
      logLevel: env('LOG_LEVEL', 'info'),
    },
    database: {
      file: resolveFromProjectRoot(env('DATABASE_FILE', './data/boodschappen.db')),
    },
    cache: {
      defaultTtlSeconds: envInt('CACHE_TTL_SECONDS', 3600),
      maxEntries: envInt('CACHE_MAX_ENTRIES', 2000),
    },
    sync: {
      allowNetwork: envBool('ALLOW_NETWORK', true),
      requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', 15_000),
      maxRetries: envInt('SYNC_MAX_RETRIES', 2),
      retryDelayMs: envInt('SYNC_RETRY_DELAY_MS', 500),
    },
    sources,
    prijsprofeet: {
      baseUrl: prijsprofeetBaseUrl,
      apiKey: prijsprofeetKey,
      // PrijsProfeet vraagt jezelf te noemen in de User-Agent; zo kunnen ze je
      // bij een wijziging in de data bereiken.
      userAgent: env('PRIJSPROFEET_USER_AGENT', 'BoodschappenApp/1.0'),
      isConfigured: prijsprofeetBaseUrl.length > 0 && prijsprofeetKey.length > 0,
    },
    openFoodFacts: {
      // Standaard UIT. In de grond gaat er niets van je machine naar iemand
      // anders tenzij je er zelf om vraagt; hiermee zou zonder toestemming een
      // barcode naar een externe dienst gaan. Zet dit op `true` als je
      // productinformatie op wilt halen (er komen nooit prijzen vandaan).
      enabled: envBool('OPEN_FOOD_FACTS_ENABLED', false),
      baseUrl: env('OPEN_FOOD_FACTS_URL', 'https://world.openfoodfacts.org'),
      userAgent: env('OPEN_FOOD_FACTS_USER_AGENT', 'BoodschappenApp/1.0 (https://example.nl/boodschappen-app)'),
    },
    defaultUser: {
      id: env('DEFAULT_USER_ID', 'default-user'),
      displayName: env('DEFAULT_USER_NAME', 'Gebruiker'),
    },
  };
}

function storeLabel(storeId: StoreId): string {
  switch (storeId) {
    case 'lidl':
      return 'Lidl';
    case 'albert_heijn':
      return 'Albert Heijn';
    case 'dirk':
      return 'Dirk';
    case 'kruidvat':
      return 'Kruidvat';
  }
}

/** Hoeveel bronnen er geconfigureerd zijn. */
export function configuredSourceCount(config: AppConfig): number {
  return Object.values(config.sources).filter((source) => source.isConfigured).length;
}

/** Zoekt de geconfigureerde bron voor een winkel. */
export function sourceForStore(config: AppConfig, storeId: StoreId): SourceConfig | null {
  return config.sources[SOURCE_SLUGS[storeId]] ?? null;
}

/**
 * Winkels die PrijsProfeet aanbiedt, met hun slug in die API.
 *
 * Kruidvat ontbreekt met opzet: het is een drogist en geen supermarkt.
 */
export const PRIJSPROFEET_STORE_SLUGS: Partial<Record<StoreId, string>> = {
  lidl: 'lidl',
  albert_heijn: 'albert_heijn',
  dirk: 'dirk',
};

/**
 * Welke bron een winkel werkelijk gebruikt.
 *
 * Een eigen `SOURCE_<WINKEL>_*` heeft voorrang: als je ooit een directe
 * winkelkoppeling hebt, wint die van de gedeelde prijsbron. Anders valt de
 * winkel terug op PrijsProfeet, en anders blijft hij ongekoppeld.
 *
 * Zowel het adapterregister als de frontendstatus gebruiken deze ene functie,
 * zodat ze niet kunnen zeggen dat een winkel gekoppeld is terwijl de ander zegt
 * dat dat niet zo is.
 */
export function effectiveSourceFor(
  config: AppConfig,
  storeId: StoreId,
): { provider: string; label: string; configured: boolean; documentationUrl: string | null } {
  const own = sourceForStore(config, storeId);
  if (own && own.isConfigured) {
    return {
      provider: own.provider,
      label: own.label,
      configured: true,
      documentationUrl: own.documentationUrl,
    };
  }
  if (config.prijsprofeet.isConfigured && PRIJSPROFEET_STORE_SLUGS[storeId]) {
    return {
      provider: 'PRIJSPROFEET',
      label: `${storeLabel(storeId)} via PrijsProfeet`,
      configured: true,
      documentationUrl: 'https://www.prijsprofeet.nl/api',
    };
  }
  return {
    provider: own?.provider ?? SOURCE_SLUGS[storeId],
    label: own?.label ?? storeLabel(storeId),
    configured: false,
    documentationUrl: own?.documentationUrl ?? null,
  };
}

/**
 * Alleen dit gaat ooit naar de frontend. Let op: geen enkele sleutel, geen
 * enkel endpoint, geen enkel header.
 */
export function publicConfig(config: AppConfig): {
  version: string;
  environment: string;
  networkEnabled: boolean;
  defaultCacheTtlSeconds: number;
  sources: Array<{ storeId: StoreId; provider: string; label: string; configured: boolean; documentationUrl: string | null }>;
  productMetadataEnabled: boolean;
} {
  return {
    version: process.env.npm_package_version ?? '1.0.0',
    environment: env('NODE_ENV', 'development'),
    networkEnabled: config.sync.allowNetwork,
    defaultCacheTtlSeconds: config.cache.defaultTtlSeconds,
    sources: STORE_IDS.map((storeId) => {
      const effective = effectiveSourceFor(config, storeId);
      return {
        storeId,
        provider: effective.provider,
        label: effective.label,
        configured: effective.configured,
        documentationUrl: effective.documentationUrl,
      };
    }),
    productMetadataEnabled: config.openFoodFacts.enabled,
  };
}
