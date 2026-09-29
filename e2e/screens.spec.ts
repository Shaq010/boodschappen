import { expect, test, type Page, type ConsoleMessage } from '@playwright/test';
import { syncAndWait } from './sync.js';

/**
 * Tests die alleen een echte browser kan beantwoorden.
 *
 * Vitest draait in jsdom: geen layout, geen schermbreedte, geen echte
 * Intl-tegels. Alles hieronder gaat over dingen die jsdom per definitie niet
 * ziet en die in de praktijk het vaakst stilletjes misgaan.
 */

const ROUTES = [
  { path: '/', name: 'dashboard' },
  { path: '/lijst', name: 'lijst' },
  { path: '/menu', name: 'menu' },
  { path: '/aanbiedingen', name: 'aanbiedingen' },
  { path: '/prijzen', name: 'prijzen' },
  { path: '/voorraad', name: 'voorraad' },
  { path: '/instellingen', name: 'instellingen' },
];

/** Console-fouten en React-waarschuwingen opvangen per test. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

/**
 * Meten of de pagina horizontaal overloopt.
 *
 * Dit is de check die jsdom niet kan doen: er is geen viewport en geen
 * scrollbar. Op een telefoon betekent horizontale scroll meteen dat de layout
 * kapot is, ook als elke test op de desktop groen is.
 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // Een halve pixel verschil door afronding telt niet als een bug.
    return Math.max(0, Math.round(doc.scrollWidth - doc.clientWidth));
  });
}

/** Het breedste element dat over de rand steekt, voor een leesbare foutmelding. */
async function widestOffender(page: Page): Promise<string> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    let worst = '';
    let worstWidth = 0;
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const over = rect.right - limit;
      if (over > 1 && over > worstWidth) {
        worstWidth = over;
        worst = `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} (${Math.round(rect.width)}px breed, steekt ${Math.round(over)}px uit)`;
      }
    }
    return worst;
  });
}

test.describe('alle schermen', () => {
  for (const route of ROUTES) {
    test(`${route.name} laadt zonder console-fouten`, async ({ page }) => {
      const problems = watchConsole(page);

      const response = await page.goto(route.path, { waitUntil: 'networkidle' });

      expect(response?.status(), `HTTP-status van ${route.path}`).toBeLessThan(400);
      // Iets zichtbaars, anders bewijst een lege pagina niets.
      await expect(page.locator('main')).toBeVisible();
      expect(problems, `console op ${route.path}`).toEqual([]);
    });
  }

  for (const route of ROUTES) {
    test(`${route.name} past binnen het scherm`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'networkidle' });
      await expect(page.locator('main')).toBeVisible();

      const overflow = await horizontalOverflow(page);

      expect(overflow, `horizontale overflow op ${route.path}: ${await widestOffender(page)}`).toBe(0);
    });
  }
});

test.describe('prijsweergave', () => {
  test('toont euro met een niet-afbreekbare spatie', async ({ page, request }) => {
    // Sync via de API in plaats van via een knop: dan leunt deze test niet op
    // de vormgeving van de synccknop.
    await syncAndWait(request);

    await page.goto('/aanbiedingen', { waitUntil: 'networkidle' });

    const inhoud = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(inhoud, 'er staat een eurobedrag op de pagina').toMatch(/€/);

    // '€ 1,19' met U+00A0 ertussen, niet '€1,19' en niet 'EUR 1,19'.
    expect(inhoud).toMatch(/€[\u00a0 ]\d/);
    expect(inhoud).not.toMatch(/EUR\s?\d/);

    // Nederlands gebruikt een komma als decimaalteken.
    expect(inhoud, 'prijzen met komma, niet met punt').toMatch(/€[\u00a0 ]\d+,\d\d/);
  });

  test('een loyaltyprijs is herkenbaar als kaartprijs', async ({ page, request }) => {
    await syncAndWait(request);
    await page.goto('/aanbiedingen', { waitUntil: 'networkidle' });

    const inhoud = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    // De kaartprijs (goudse kaas) mag niet als gewone actieprijs verschijnen.
    expect(inhoud, 'de kaartvoorwaarde staat erbij').toMatch(/alleen met/i);
  });
});

test.describe('navigatie', () => {
  /**
   * Alleen het hoofdmenu, niet andere navigaties die in de pagina's zelf
   * staan. De shell geeft het zijbalkmenu een naam en het mobiele menu een id.
   */
  // Alleen zichtbare links: op mobiel staat de zijbalk wel in de DOM maar is
  // die CSS-verborgen, en die telt hier niet mee.
  const hoofdmenu = 'nav[aria-label="Hoofdmenu"] a:visible, #mobiel-menu a:visible';

  /** Opent de navigatie, hoe die op dit scherm ook heet. */
  async function openNavigation(page: Page): Promise<void> {
    const menuKnop = page.getByRole('button', { name: /^menu$/i });
    if (await menuKnop.isVisible().catch(() => false)) {
      await menuKnop.click();
    }
    // Op desktop staat de zijbalk er al; dat hoeft dus niets te doen.
  }

  test('alle zeven schermen zijn bereikbaar vanuit de navigatie', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await openNavigation(page);

    // Zeven links: dashboard, lijst, weekmenu, aanbiedingen, prijzen,
    // voorraad en instellingen.
    await expect(page.locator(hoofdmenu)).toHaveCount(7);

    for (const label of ['Lijst', 'Weekmenu', 'Aanbiedingen', 'Prijzen', 'Voorraad', 'Instellingen']) {
      await expect(page.getByRole('link', { name: label }).first()).toBeVisible();
    }
  });

  test('navigatielinks zijn groot genoeg om aan te tikken', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await openNavigation(page);

    const link = page.getByRole('link', { name: 'Instellingen' }).first();
    await expect(link).toBeVisible();

    const box = await link.boundingBox();

    // Een tikdoel kleiner dan 32px is lastig op een telefoon.
    expect(box?.height ?? 0, 'hoogte van een navigatielink').toBeGreaterThanOrEqual(32);
  });

  test('het mobiele menu klapt open en dicht', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'geldt alleen voor het mobiele schermformaat');

    await page.goto('/', { waitUntil: 'networkidle' });
    // De knop wisselt van tekst (Menu/Sluiten); aria-controls niet. Selecteer
    // dus op die, anders is de tweede klik onmogelijk.
    const menuKnop = page.locator('button[aria-controls="mobiel-menu"]');
    await menuKnop.click();
    await expect(page.locator('#mobiel-menu a').first()).toBeVisible();
    await expect(menuKnop).toHaveAttribute('aria-expanded', 'true');

    await menuKnop.click();
    await expect(page.locator('#mobiel-menu a')).toHaveCount(0);
    await expect(menuKnop).toHaveAttribute('aria-expanded', 'false');
  });

  test('een onbekend adres stuurt terug naar het dashboard', async ({ page }) => {
    await page.goto('/dit-bestandt-niet', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/$/);
  });
});
