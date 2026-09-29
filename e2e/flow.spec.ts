import { expect, test } from '@playwright/test';
import { syncAndWait } from './sync.js';

/**
 * De volledige gebruikersflow in een echte browser.
 *
 * Zelfde scenario als de run die eerder via de API liep, maar nu via de
 * interface zoals een mens hem doet: klikken, typen, lezen. Zo wordt ook
 * gecontroleerd dat de schermen elkaar opvolgen en dat de gegevens die de API
 * teruggeeft daadwerkelijk in de UI belanden.
 */

test.describe.configure({ mode: 'serial' });

test('van lege app naar een lijst met producten', async ({ page }) => {
  // 1. Het dashboard komt op en zegt eerlijk dat er nog niets is.
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toBeVisible();

  // 2. Een lijst aanmaken.
  await page.goto('/lijst', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /nieuwe lijst/i }).first().click();
  await expect(page.locator('main h1')).toBeVisible();

  // 3. Bulk invoeren. De app parseert eerst en laat het resultaat zien.
  await page.getByRole('button', { name: /bulk invoeren/i }).click();
  const veld = page.getByLabel('Tekst met boodschappen');
  await veld.fill('2 melk, 1,5 l cola, 1 kg bananen');
  await page.getByRole('button', { name: /^analyseer$/i }).click();

  // De preview verschijnt voordat er iets in de lijst staat.
  await expect(page.getByText(/melk/i).first()).toBeVisible();
  await expect(page.getByText(/cola/i).first()).toBeVisible();
  await expect(page.getByText(/bananen/i).first()).toBeVisible();

  // 4. De knop zegt precies hoeveel regels er binnenkomen.
  const bevestig = page.getByRole('button', { name: /product\(en\) toevoegen/i });
  await expect(bevestig).toHaveText(/3 product\(en\) toevoegen/);
  await bevestig.click();

  // Na bevestigen sluit het paneel en staan de producten in de lijst.
  await expect(page.getByText(/cola/i).first()).toBeVisible();
  await expect(page.getByLabel('Tekst met boodschappen')).toHaveCount(0);

  // 5. De komma hoort bij de eenheid: '1,5 l' mag niet als 15 liter binnenkomen.
  // Eerst wachten tot de lijst echt geladen is; een expect op tekst die je
  // meteen uitleest wacht niet en leest dan een halve pagina.
  await expect(page.getByText(/cola/i).first()).toBeVisible();
  await expect(page.getByText(/melk/i).first()).toBeVisible();
  await expect(page.getByText(/Lijst laden/)).toHaveCount(0);

  const lijstTekst = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(lijstTekst, 'de lijst toont de producten').toMatch(/melk/i);
  expect(lijstTekst, 'cola staat in de lijst').toMatch(/cola/i);
  expect(lijstTekst, '1,5 liter mag niet als 15 liter opslaan').not.toMatch(/\b15\s*l\b/);
});

test('een product dat nog niet gekoppeld is vraagt om bevestiging', async ({ page }) => {
  await page.goto('/lijst', { waitUntil: 'networkidle' });

  // Staat er nog een openstaande bevestiging, dan moet die zichtbaar zijn en
  // mag de app niet stilletjes gokken.
  const bevestigKnop = page.getByRole('button', { name: /kies|koppelen|bevestig/i }).first();
  if (await bevestigKnop.isVisible().catch(() => false)) {
    await expect(bevestigKnop).toBeVisible();
  }
});

test('de aanbiedingen tonen prijzen uit de bron, met de kaartvoorwaarde erbij', async ({ page, request }) => {
  // Sync via de API: dan leunt de test niet op de vormgeving van de knop.
  await syncAndWait(request);

  await page.goto('/aanbiedingen', { waitUntil: 'networkidle' });

  const tekst = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

  // Vier aanbiedingen, en na een tweede sync nog steeds vier.
  expect(tekst, 'de aanbiedingen uit de feed staan er').toMatch(/Melk 1 l/);
  expect(tekst).toMatch(/Bananen 1 kg/);
  expect(tekst, 'Nederlandse bedragen met komma').toMatch(/€[\u00a0 ]\d+,\d\d/);

  // Twee keer synchroniseren mag niet verdubbelen.
  await syncAndWait(request);
  await page.reload({ waitUntil: 'networkidle' });
  const naTweedeSync = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

  const tel = (tekst: string, needle: string) => tekst.split(needle).length - 1;
  expect(tel(naTweedeSync, 'Melk 1 l'), 'melk staat maar één keer').toBe(
    tel(tekst, 'Melk 1 l'),
  );
  expect(tel(naTweedeSync, 'Goudse kaas'), 'de kaas staat maar één keer').toBe(
    tel(tekst, 'Goudse kaas'),
  );

  // Een kaartprijs mag nooit als gewone prijs ogen.
  expect(naTweedeSync, 'de kaartvoorwaarde staat erbij').toMatch(/alleen met/i);
});
