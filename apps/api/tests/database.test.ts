import { describe, expect, it } from 'vitest';
import { openDatabase, migrateFile } from '../src/db/client.js';
import { seedStores } from '../src/db/seed.js';
import { MIGRATIONS } from '../src/db/migrations.js';
import { offers, prices, products, storeProducts, stores } from '../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';

describe('migraties', () => {
  it('maakt alle tabellen aan', () => {
    const { sqlite, db } = openDatabase({ file: ':memory:' });
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const expected of [
      'users', 'stores', 'data_sources', 'products', 'product_aliases', 'store_products',
      'prices', 'offers', 'price_history', 'shopping_lists', 'shopping_items', 'pantry_items',
      'weekly_menus', 'meals', 'ingredients', 'import_batches', 'app_settings',
    ]) {
      expect(tables).toContain(expected);
    }
    void db;
    sqlite.close();
  });

  it('draait iedere migratie maar één keer', () => {
    const file = '/tmp/opencode/api-migratie-test.db';
    migrateFile(file, false);
    migrateFile(file, false);

    const { sqlite } = openDatabase({ file });
    const applied = sqlite.prepare('SELECT name FROM _migrations').all();
    expect(applied).toHaveLength(MIGRATIONS.length);
    sqlite.close();
  });

  it('zet foreign keys aan zodat verwijzingen kloppen', () => {
    const { sqlite } = openDatabase({ file: ':memory:' });
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      sqlite.prepare("INSERT INTO prices (id, store_id, store_product_id, product_id, currency) VALUES ('p','lidl','sp','pr','EUR')").run(),
    ).toThrow();
    sqlite.close();
  });
});

describe('startgegevens', () => {
  it('plaatst de vier winkels met klantenkaartnaam', () => {
    const { db, sqlite } = openDatabase({ file: ':memory:' });
    seedStores(db);

    const rows = db.select().from(stores).all();
    expect(rows.map((r) => r.id)).toEqual(['lidl', 'albert_heijn', 'dirk', 'kruidvat']);
    expect(rows.find((r) => r.id === 'albert_heijn')?.loyaltyCardName).toBe('AH Bonuskaart');
    expect(rows.every((r) => r.currency === 'EUR')).toBe(true);
    sqlite.close();
  });

  it('is idempotent: twee keer seeden geeft geen dubbele winkels', () => {
    const { db, sqlite } = openDatabase({ file: ':memory:' });
    seedStores(db);
    seedStores(db);
    expect(db.select().from(stores).all()).toHaveLength(4);
    sqlite.close();
  });

  it('laadt GEEN prijzen, aanbiedingen of producten in', () => {
    const { db, sqlite } = openDatabase({ file: ':memory:' });
    seedStores(db);

    // De app mag nooit starten met verzonnen data.
    expect(db.select().from(products).all()).toHaveLength(0);
    expect(db.select().from(prices).all()).toHaveLength(0);
    expect(db.select().from(offers).all()).toHaveLength(0);
    expect(db.select({ n: sql<number>`count(*)` }).from(stores).get()?.n).toBe(4);
    sqlite.close();
  });

  it('kan een aanbieding opslaan en bij een winkel opvragen', () => {
    const { db, sqlite } = openDatabase({ file: ':memory:' });
    seedStores(db);

    db.insert(products)
      .values({ id: 'p1', name: 'Melk', normalizedName: 'melk', canonicalName: 'melk', category: 'zuivel' })
      .run();
    // Een aanbieding verwijst altijd naar het artikel zoals de winkel het noemt.
    db.insert(storeProducts)
      .values({
        id: 'sp1',
        storeId: 'lidl',
        productId: 'p1',
        storeProductId: 'lidl-melk',
        storeName: 'Melk 2 liter',
      })
      .run();
    db.insert(offers)
      .values({
        id: 'o1',
        storeId: 'lidl',
        storeProductId: 'sp1',
        productId: 'p1',
        title: 'Melk 2 liter',
        kind: 'price_drop',
        conditions: {},
        offerPriceCents: 129,
        regularPriceCents: 199,
        currency: 'EUR',
        storeName: 'Lidl',
        validUntil: '2026-10-04',
      })
      .run();

    const found = db.select().from(offers).where(eq(offers.storeId, 'lidl')).all();
    expect(found).toHaveLength(1);
    expect(found[0]?.offerPriceCents).toBe(129);
    sqlite.close();
  });
});
