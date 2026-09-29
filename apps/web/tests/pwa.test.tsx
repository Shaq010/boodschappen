import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../src/components/shell.js';

/**
 * Zoekt de app-map. In de jsdom-omgeving is `import.meta.url` geen file-URL.
 * De test kan zowel vanuit de webapp-map als vanuit de monorepo-root draaien,
 * dus we kijken op beide plekken.
 */
function findAppDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    for (const kandidaat of [dir, resolve(dir, 'apps/web')]) {
      if (
        existsSync(resolve(kandidaat, 'index.html')) &&
        existsSync(resolve(kandidaat, 'public/manifest.webmanifest'))
      ) {
        return `${resolve(kandidaat)}/`;
      }
    }
    dir = resolve(dir, '..');
  }
  throw new Error('De map van de webapp niet gevonden');
}

const appDir = findAppDir();
const read = (name: string) => readFileSync(`${appDir}${name}`, 'utf8');
const readBytes = (name: string) => readFileSync(`${appDir}${name}`);

/**
 * Deze tests bewaken de PWA-laag.
 *
 * Zonder manifest, apple-touch-icon en de iOS-meta is de app op een iPhone
 * gewoon een website in een venster: geen icoontje op het beginscherm en
 * Safari-UI erboven. Dat merk je pas als je hem op je telefoon zet, dus hier
 * staat een vangnet.
 */
describe('installatie op het beginscherm (PWA)', () => {
  it('koppelt een webmanifest aan', () => {
    expect(read('index.html')).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  it('vertelt iOS dat dit een eigen app is', () => {
    const html = read('index.html');
    // Zonder deze tag opent "Zet op beginscherm" een Safari-tablet.
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="Boodschappen"/);
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style/);
  });

  it('heeft een apple-touch-icon dat iOS kan tonen', () => {
    expect(read('index.html')).toMatch(/rel="apple-touch-icon"/);
    // iOS vult transparante hoeken zwart in; het icoon moet dus dekkend zijn.
    const icon = readBytes('public/icons/apple-touch-icon.png');
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(icon.length).toBeGreaterThan(500);
  });

  it('heeft een manifest dat de icoontjes aanwijst die ook echt bestaan', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      name: string;
      start_url: string;
      display: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.name.length).toBeGreaterThan(0);

    const maten = new Set(manifest.icons.map((icon) => icon.sizes));
    expect(maten).toContain('192x192');
    expect(maten).toContain('512x512');
    // Een maskable icoon nodig voor Android, waar het tegelwerk bijgeplakt wordt.
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    for (const icon of manifest.icons) {
      // Verwijst het manifest naar een icoon dat er niet is, dan blijft het
      // beginscherm-icoontje leeg zonder dat je iets ziet gebeuren.
      expect(readBytes(`public${icon.src}`).length).toBeGreaterThan(0);
    }
  });

  it('heeft de iconen die het manifest aanwijst, en geen verwijzing naar een ontbrekend bestand', () => {
    const html = read('index.html');
    const verwijzingen = [...html.matchAll(/href="\/icons\/([^"]+)"/g)].map((match) => match[1]!);
    expect(verwijzingen.length).toBeGreaterThan(0);
    for (const bestand of verwijzingen) {
      expect(readBytes(`public/icons/${bestand}`).length).toBeGreaterThan(0);
    }
  });
});

describe('bronvermelding', () => {
  it('noemt PrijsProfeet op elke pagina, want het gratis plan eist dat', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <p>inhoud</p>
        </AppShell>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /prijsprofeet/i });
    expect(link.getAttribute('href')).toBe('https://www.prijsprofeet.nl/api');
    // Zonder dit is het gebruik van de gratis sleutel buiten hun voorwaarden.
    expect(screen.getByText(/controleer de prijs in de winkel/i)).toBeTruthy();
  });
});

it('debug: cwd', () => {
  console.log('CWD =', process.cwd());
});
