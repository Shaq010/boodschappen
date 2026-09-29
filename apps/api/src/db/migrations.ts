/**
 * Migraties.
 *
 * Elke migratie draait één keer. Voeg nieuwe migraties altijd onderaan toe en
 * wijzig bestaande migraties nooit: op een bestaande database zijn ze al
 * toegepast.
 */

import type { Migration } from './migration-types.js';

export type { Migration };

export const MIGRATIONS: readonly Migration[] = [
  {
    name: '0001_init',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT 'Gebruiker',
        email TEXT,
        locale TEXT NOT NULL DEFAULT 'nl',
        timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
        settings TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);`,

      `CREATE TABLE IF NOT EXISTS stores (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        website TEXT,
        adapter TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        loyalty_card_name TEXT,
        color TEXT NOT NULL DEFAULT '#0a5ca8',
        display_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS stores_order_idx ON stores (display_order);`,

      `CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_configured',
        documentation_url TEXT,
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        offers_imported INTEGER NOT NULL DEFAULT 0,
        prices_imported INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS data_sources_store_idx ON data_sources (store_id);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS data_sources_provider_store_idx ON data_sources (provider, store_id);`,

      `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        brand TEXT,
        category TEXT NOT NULL DEFAULT 'overig',
        drink_kind TEXT,
        unit TEXT,
        unit_dimension TEXT,
        unit_amount REAL,
        quantity_hint TEXT,
        gtin TEXT,
        source TEXT NOT NULL DEFAULT 'handmatig',
        verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS products_normalized_idx ON products (normalized_name);`,
      `CREATE INDEX IF NOT EXISTS products_canonical_idx ON products (canonical_name);`,
      `CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);`,
      `CREATE INDEX IF NOT EXISTS products_drink_kind_idx ON products (drink_kind);`,
      `CREATE INDEX IF NOT EXISTS products_gtin_idx ON products (gtin);`,

      `CREATE TABLE IF NOT EXISTS product_aliases (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_alias_idx ON product_aliases (normalized_alias);`,
      `CREATE INDEX IF NOT EXISTS product_aliases_product_idx ON product_aliases (product_id);`,

      `CREATE TABLE IF NOT EXISTS store_products (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        store_product_id TEXT NOT NULL,
        gtin TEXT,
        store_name TEXT NOT NULL,
        pack_description TEXT,
        product_url TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS store_products_store_item_idx ON store_products (store_id, store_product_id);`,
      `CREATE INDEX IF NOT EXISTS store_products_product_idx ON store_products (product_id);`,
      `CREATE INDEX IF NOT EXISTS store_products_gtin_idx ON store_products (gtin);`,

      `CREATE TABLE IF NOT EXISTS prices (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        store_product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        regular_price_cents INTEGER,
        offer_price_cents INTEGER,
        discount_percent REAL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        in_stock INTEGER NOT NULL DEFAULT 1,
        pack_quantity REAL,
        pack_unit TEXT,
        observed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS prices_store_product_idx ON prices (store_product_id, store_id);`,
      `CREATE INDEX IF NOT EXISTS prices_product_store_idx ON prices (product_id, store_id);`,
      `CREATE INDEX IF NOT EXISTS prices_observed_idx ON prices (observed_at);`,

      `CREATE TABLE IF NOT EXISTS offers (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        store_product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        kind TEXT NOT NULL DEFAULT 'price_drop',
        conditions TEXT NOT NULL DEFAULT '{}',
        offer_price_cents INTEGER,
        regular_price_cents INTEGER,
        currency TEXT NOT NULL DEFAULT 'EUR',
        valid_from TEXT,
        valid_until TEXT,
        store_name TEXT NOT NULL,
        pack_description TEXT,
        source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
        source_name TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS offers_product_idx ON offers (product_id);`,
      `CREATE INDEX IF NOT EXISTS offers_store_idx ON offers (store_id);`,
      `CREATE INDEX IF NOT EXISTS offers_validity_idx ON offers (valid_from, valid_until);`,
      `CREATE INDEX IF NOT EXISTS offers_store_product_idx ON offers (store_product_id);`,

      `CREATE TABLE IF NOT EXISTS price_history (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        store_product_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        regular_price_cents INTEGER,
        offer_price_cents INTEGER,
        is_offer INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'EUR',
        price_date TEXT NOT NULL,
        source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS price_history_product_date_idx ON price_history (product_id, price_date);`,
      `CREATE INDEX IF NOT EXISTS price_history_store_date_idx ON price_history (store_id, price_date);`,

      `CREATE TABLE IF NOT EXISTS shopping_lists (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL DEFAULT 'Mijn boodschappen',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS shopping_lists_user_idx ON shopping_lists (user_id);`,

      `CREATE TABLE IF NOT EXISTS shopping_items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        dimension TEXT NOT NULL DEFAULT 'count',
        amount REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'st',
        checked INTEGER NOT NULL DEFAULT 0,
        in_pantry INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        origin TEXT NOT NULL DEFAULT 'manual',
        source_ingredient_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS shopping_items_list_idx ON shopping_items (list_id);`,
      `CREATE INDEX IF NOT EXISTS shopping_items_normalized_idx ON shopping_items (normalized_name);`,
      `CREATE INDEX IF NOT EXISTS shopping_items_product_idx ON shopping_items (product_id);`,

      `CREATE TABLE IF NOT EXISTS pantry_items (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        dimension TEXT NOT NULL DEFAULT 'count',
        amount REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'st',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS pantry_items_user_idx ON pantry_items (user_id);`,
      `CREATE INDEX IF NOT EXISTS pantry_items_normalized_idx ON pantry_items (normalized_name);`,

      `CREATE TABLE IF NOT EXISTS weekly_menus (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        week_start TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS weekly_menus_user_week_idx ON weekly_menus (user_id, week_start);`,

      `CREATE TABLE IF NOT EXISTS meals (
        id TEXT PRIMARY KEY,
        menu_id TEXT NOT NULL REFERENCES weekly_menus(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        name TEXT NOT NULL,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS meals_menu_idx ON meals (menu_id);`,

      `CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        dimension TEXT NOT NULL DEFAULT 'count',
        amount REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'st',
        in_pantry INTEGER NOT NULL DEFAULT 0,
        only_if_missing INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS ingredients_meal_idx ON ingredients (meal_id);`,
      `CREATE INDEX IF NOT EXISTS ingredients_normalized_idx ON ingredients (normalized_name);`,

      `CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
        source_id TEXT REFERENCES data_sources(id) ON DELETE SET NULL,
        format TEXT NOT NULL,
        file_name TEXT,
        row_count INTEGER NOT NULL DEFAULT 0,
        accepted_count INTEGER NOT NULL DEFAULT 0,
        rejected_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'preview',
        notes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
      `CREATE INDEX IF NOT EXISTS import_batches_store_idx ON import_batches (store_id);`,

      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );`,
    ],
  },
];
