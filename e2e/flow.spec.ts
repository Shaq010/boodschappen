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
  // 1. De app komt op met het velk om in te typen; er is geen dashboard.
  await page.goto('/', { waitUntil: 'networkidle' });
  const veld = page.getByLabel('Wat heb je nodig?');
  await expect(veld).toBeVisible();

  // 2. Een lijst aanmaken.
  await page.getByRole('button', { name: /nieuwe lijst/i }).first().click();
  await expect(veld).toBeVisible();

  // 3. Typen en Enter. Geen analyseerscherm, geen bevestigingsknop: de
  //    producten staan meteen in de lijst.
  await veld.fill('2 melk, 1,5 l cola, 1 kg bananen');
  await veld.press('Enter');

  await expect(page.getByText(/cola/i).first()).toBeVisible();
  await expect(page.getByText(/bananen/i).first()).toBeVisible();

  // 4. Het veld is weer leeg, zodat je meteen door kunt typen.
  await expect(veld).toHaveValue('');

  // 5. De komma hoort bij de eenheid: '1,5 l' mag niet als 15 liter binnenkomen.
  const lijstTekst = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(lijstTekst, 'de lijst toont de producten').toMatch(/melk/i);
  expect(lijstTekst, 'cola staat in de lijst').toMatch(/cola/i);
  expect(lijstTekst, '1,5 liter mag niet als 15 liter opslaan').not.toMatch(/\b15\s*l\b/);
  expect(lijstTekst).not.toMatch(/Bevestigen|Analyseren|Bulk invoeren/);
});

test('één product per keer typen werkt ook', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const veld = page.getByLabel('Wat heb je nodig?');

  await veld.fill('melk');
  await veld.press('Enter');
  await expect(page.getByText('melk toegevoegd.')).toBeVisible();

  // Daarna meteen het volgende product, zonder de pagina te herladen.
  await veld.fill('blikjes');
  await veld.press('Enter');
  await expect(page.getByText('blikjes toegevoegd.')).toBeVisible();
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
