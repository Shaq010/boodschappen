/**
 * Databaseverbinding met migraties die bij het opstarten worden uitgevoerd.
 *
 * We gebruiken bewust handgeschreven migraties in plaats van drizzle-kit:
 * zo draait de applicatie zonder extra build-stap en is de database altijd in
 * een consistente staat. De migraties zijn idempotent.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { schema } from './schema.js';
import { type Migration, MIGRATIONS } from './migrations.js';

export type Database_ = BetterSQLite3Database<typeof schema>;
export type SqliteDatabase = Database.Database;

export interface OpenOptions {
  file: string;
  readonly?: boolean;
  verbose?: boolean;
}

/** Voert alle nog niet toegepaste migraties uit. */
function applyMigrations(db: Database.Database, options: { verbose?: boolean } = {}): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((row) => (row as { name: string }).name),
  );

  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    const run = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement);
      insert.run(migration.name, new Date().toISOString());
    });
    run();
    if (options.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[db] migratie toegepast: ${migration.name}`);
    }
  }
}

export function openDatabase(options: OpenOptions): { db: Database_; sqlite: SqliteDatabase } {
  const filePath = options.file === ':memory:' ? options.file : resolve(options.file);

  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const sqlite = new Database(filePath, {
    readonly: options.readonly ?? false,
    verbose: options.verbose ? (message?: unknown) => console.debug(String(message)) : undefined,
  });

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  // Duizendstreepjes maken SQLite wiskundig correct rekenen.
  sqlite.pragma('trusted_schema = OFF');

  applyMigrations(sqlite, { verbose: options.verbose });

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Alleen migraties uitvoeren zonder verbinding te houden (voor scripts/tests). */
export function migrateFile(file: string, verbose = false): void {
  const filePath = file === ':memory:' ? file : resolve(file);
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite, { verbose });
  sqlite.close();
}
