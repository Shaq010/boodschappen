/**
 * Migraties draaien: `npm run db:migrate` (of `db:reset` om opnieuw te beginnen).
 *
 * Let op: er worden GEEN voorbeeldprijzen of voorbeeldproducten ingeladen. De
 * app start leeg op; de gebruiker bouwt zijn eigen lijst en de prijzen komen uit
 * de gekoppelde databronnen.
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { migrateFile } from './client.js';
import { seedStores } from './seed.js';
import { openDatabase } from './client.js';

const config = loadConfig();
const file = resolve(config.database.file);
const reset = process.argv.includes('--reset');

if (reset && file !== ':memory:' && existsSync(file)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${file}${suffix}`;
    if (existsSync(path)) rmSync(path);
  }
  console.log(`[db] database opnieuw aangemaakt: ${file}`);
}

migrateFile(file, true);

const { db, sqlite } = openDatabase({ file });
seedStores(db);
sqlite.close();

console.log('[db] migraties voltooid');
