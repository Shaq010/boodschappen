/**
 * Samenstelling van de applicatie: database, cache, HTTP-client en services.
 *
 * Eén plek die alles opzet, zodat de server, de tests en de scripts dezelfde
 * objecten gebruiken.
 */

import { type AppConfig, loadConfig, publicConfig } from './config.js';
import { type Database_, migrateFile, openDatabase } from './db/client.js';
import { seedStores, seedUser } from './db/seed.js';
import { AdapterRegistry } from './adapters/index.js';
import { TtlCache } from './services/cache.js';
import { HttpClient } from './services/http.js';
import { SyncService } from './services/sync.js';
import { ShoppingService } from './services/shopping.js';
import { MenuService, PantryService } from './services/menu.js';
import { randomUUID } from 'node:crypto';

export interface App {
  config: AppConfig;
  db: Database_;
  cache: TtlCache;
  http: HttpClient;
  registry: AdapterRegistry;
  sync: SyncService;
  shopping: ShoppingService;
  pantry: PantryService;
  menu: MenuService;
  publicConfig: ReturnType<typeof publicConfig>;
  /** Sluit de databaseverbinding af. */
  close: () => void;
}

export interface CreateAppOptions {
  config?: AppConfig;
  /** Overschrijft de database, bijvoorbeeld ':memory:' in tests. */
  databaseFile?: string;
  /** Migraties overslaan (de database is dan al up to date). */
  skipMigrations?: boolean;
  /** Injecteerbare fetch voor tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function createApp(options: CreateAppOptions = {}): App {
  const config = options.config ?? loadConfig();
  const file = options.databaseFile ?? config.database.file;

  if (!options.skipMigrations && file !== ':memory:') {
    migrateFile(file, false);
  }

  const { db, sqlite } = openDatabase({ file });
  seedStores(db);
  seedUser(db, config.defaultUser.id, config.defaultUser.displayName);

  const cache = new TtlCache({
    maxEntries: config.cache.maxEntries,
    defaultTtlSeconds: config.cache.defaultTtlSeconds,
  });

  const http = new HttpClient({
    allowNetwork: config.sync.allowNetwork,
    timeoutMs: config.sync.requestTimeoutMs,
    maxRetries: config.sync.maxRetries,
    retryDelayMs: config.sync.retryDelayMs,
    userAgent: config.openFoodFacts.userAgent,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const registry = new AdapterRegistry(config);
  const sync = new SyncService({
    config,
    db,
    http,
    cache,
    registry,
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    config,
    db,
    cache,
    http,
    registry,
    sync,
    shopping: new ShoppingService(db, sync.products),
    pantry: new PantryService(db),
    menu: new MenuService(db),
    publicConfig: publicConfig(config),
    close: () => sqlite.close(),
  };
}

export { randomUUID };
