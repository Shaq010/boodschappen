/**
 * Tests voor de runtime-configuratie.
 *
 * De belangrijkste hier: het databasepad mag niet van de werkmap afhangen. Zie
 * de toelichting bij `projectRoot` in `src/config.ts`; een app die vanuit twee
 * verschillende mappen gestart kan worden, mag nooit twee databases hebben.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { loadConfig, publicConfig } from '../src/config.js';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const originalCwd = process.cwd();
const originalFile = process.env.DATABASE_FILE;

function resetEnv(): void {
  if (originalFile === undefined) delete process.env.DATABASE_FILE;
  else process.env.DATABASE_FILE = originalFile;
}

afterEach(() => {
  process.chdir(originalCwd);
  resetEnv();
});

describe('databasepad', () => {
  it('ligt standaard op de projectroot, niet in de werkmap', () => {
    delete process.env.DATABASE_FILE;

    const file = loadConfig().database.file;

    expect(file).toBe(resolve(projectRoot, 'data/boodschappen.db'));
  });

  it('blijft hetzelfde als de app vanuit een andere map gestart wordt', () => {
    delete process.env.DATABASE_FILE;
    // Resolve zelf mee: anders vergelijken we twee keer dezelfde relatieve
    // string en zou deze test ook groen blijven met het oude, werkmap-afhankelijke
    // gedrag.
    const expected = resolve(loadConfig().database.file);

    process.chdir('/');
    const fromElsewhere = resolve(loadConfig().database.file);

    expect(fromElsewhere).toBe(expected);
  });

  it('blijft hetzelfde als de app vanuit de api-map gestart wordt', () => {
    delete process.env.DATABASE_FILE;
    const expected = resolve(loadConfig().database.file);

    process.chdir(resolve(projectRoot, 'apps/api'));
    const fromApiDir = resolve(loadConfig().database.file);

    expect(fromApiDir).toBe(expected);
    expect(fromApiDir).toBe(resolve(projectRoot, 'data/boodschappen.db'));
  });

  it('zet een relatief DATABASE_FILE onder de projectroot', () => {
    process.env.DATABASE_FILE = './data/eigen.db';

    expect(loadConfig().database.file).toBe(resolve(projectRoot, 'data/eigen.db'));
  });

  it('laat een absoluet DATABASE_FILE met rust', () => {
    const absoluut = resolve('/tmp', 'absoluut.db');
    process.env.DATABASE_FILE = absoluut;

    const file = loadConfig().database.file;

    expect(file).toBe(absoluut);
    expect(isAbsolute(file)).toBe(true);
  });
});

describe('openbare configuratie', () => {
  it('lekt geen geheimen naar de frontend', () => {
    process.env.SOURCE_LIDL_API_KEY = 'TOPGEHEIM';
    process.env.SOURCE_LIDL_BASE_URL = 'https://geheim.example.nl/feed';

    const publiek = JSON.stringify(publicConfig(loadConfig()));

    expect(publiek).not.toContain('TOPGEHEIM');
    expect(publiek).not.toContain('geheim.example.nl');
    resetEnv();
  });
});
