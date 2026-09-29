import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-tests in een echte browser.
 *
 * De Vitest-suites draaien in jsdom, en jsdom heeft geen layout, geen echte
 * schermbreedtes en geen Intl-tegels. Juist de dingen die in een echte browser
 * kapotgaan — horizontale scroll op een telefoon, een prijs die als "EUR 1,19"
 * in plaats van "€ 1,19" rendert, een crash die alleen in de browser optreedt —
 * worden daar niet gezien. Daarom staan deze tests er wel.
 *
 * De servers draaien in een aparte, lege database en tegen een lokale
 * testfeed, zodat de uitkomst niet van de machine of het netwerk afhangt.
 */

const API_PORT = 4100;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  // De tests delen één database, dus ze kunnen niet naast elkaar draaien.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'mobiel',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'node e2e/fixture-feed.mjs',
      url: 'http://127.0.0.1:4500/health',
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      // De API start met tsx en duurt op een WSL-schijf merkbaar langer dan
      // op een gewone dev-machine; 35 seconden is hier normaal.
      timeout: 240_000,
      env: {
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        DATABASE_FILE: './data/e2e.db',
        CACHE_TTL_SECONDS: '60',
        // Lidl is de enige bron die we in de test koppelen.
        SOURCE_LIDL_BASE_URL: 'http://127.0.0.1:4500',
        SOURCE_LIDL_API_KEY: 'e2e-test-key',
        SOURCE_LIDL_HEADERS: '',
        ALLOW_NETWORK: 'true',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: 'npm run dev:web',
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        WEB_PORT: String(WEB_PORT),
        API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
