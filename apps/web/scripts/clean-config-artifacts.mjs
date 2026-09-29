/**
 * Verwijdert gecompileerde vite-config-artifacts uit de webmap.
 *
 * Waarom dit nodig is: `tsc` kan `vite.config.ts` naar `vite.config.js`
 * naast de bron schrijven. Vite leest configuratiebestanden in de volgorde
 * .js, .mjs, .ts — dus zo'n achtergebleven .js wint van de bron die je net
 * hebt aangepast. De dev-server draait dan stil de oude configuratie, terwijl
 * je denkt dat je wijziging actief is.
 *
 * Dat is geen theorie: zo hing de poort hier vast totdat dit bestand bestond.
 *
 * We verwijderen de artifacts vóór elke build en ook in de dev-scripts, zodat
 * de bron altijd de enige waarheid is.
 */

import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const artifacts = [
  'vite.config.js',
  'vite.config.js.map',
  'vite.config.d.ts',
  'vite.config.d.ts.map',
  'vitest.config.js',
  'vitest.config.js.map',
  'vitest.config.d.ts',
  'vitest.config.d.ts.map',
];

let removed = 0;
for (const name of artifacts) {
  const path = join(webRoot, name);
  if (!existsSync(path)) continue;
  rmSync(path);
  removed += 1;
  console.log(`[web] verouderd config-artifact verwijderd: ${name}`);
}

if (removed === 0) {
  console.log('[web] geen verouderde config-artifacts gevonden');
}
