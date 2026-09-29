# Boodschappen

Een Nederlandse app voor je boodschappenlijst, weekmenu, aanbiedingen en prijsvergelijking.

De app is bewust eerlijk over prijzen: **er wordt nooit een bedrag getoond dat niet uit een
databron komt.** Lidl, Albert Heijn, Dirk en Kruidvat publiceren geen openbare API met prijzen en
verbieden geautomatiseerd ophalen van hun websites. Daarom is de prijsfunctie gekoppeld aan
officiële, geautoriseerde bronnen. Zonder zo'n bron blijven prijzen leeg en laat de app zien wat
er nodig is om ze wél te krijgen. Lees [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) voor de
uitleg per winkel.

## Wat je ermee kunt doen

- **Boodschappenlijst** — producten per stuk toevoegen of een heel lijstje plakken. De parser leest
  `2 melk`, `1,5 l cola zero` en `3 x pakken yoghurt`; een komma tussen twee cijfers blijft een
  komma, dus `1,5 l` is één regel van 1,5 liter.
- **Weekmenu** — per dag een gerecht; de benodigde ingrediënten worden opgeteld, met aftrek van wat
  je al in huis hebt.
- **Aanbiedingen** — met voorwaarden erbij: alleen met klantenkaart, vanaf meerdere stuks,
  gratis extra's. Voorwaarden staan altijd bij het bedrag, nooit erbuiten.
- **Prijsvergelijking** — per product de goedkoopste winkel, en voor je hele lijst de beste
  winkelmix: alles bij één winkel, de goedkoopste combinatie, of zo min mogelijk winkels.
- **Voorraad** — wat je al hebt, zodat je niet dubbel koopt.

## Draaien

Vereist Node 20.11 of nieuwer.

```bash
npm install
cp .env.example .env        # vul later echte brongegevens in, zie docs
npm run db:migrate          # maakt de database en de vier winkels aan
npm run dev                 # API op :4000, web op :5173
```

Open daarna <http://localhost:5173>.

Los draaien kan ook:

```bash
npm run dev:api             # alleen de API
npm run dev:web             # alleen de webinterface
```

### Zonder databron

De app werkt volledig zonder externe koppeling: je kunt lijsten, menu en voorraad vullen, en de app
laat zien dat er geen prijzen zijn. Wil je niets naar buiten sturen, zet dan in `.env`:

```bash
ALLOW_NETWORK=false
```

## Scripts

| Commando | Wat het doet |
| --- | --- |
| `npm run dev` | Start API en web tegelijk |
| `npm run build` | Bouwt kern, API en webinterface |
| `npm run typecheck` | TypeScript over alle drie de workspaces |
| `npm test` | Alle tests van de drie workspaces |
| `npm run test:core` | Alleen de domeinlogica |
| `npm run test:api` | Alleen de API |
| `npm run test:web` | Alleen de webinterface |
| `npm run test:e2e` | Browser-tests in een echte Chromium, mobiel en desktop |
| `npm run test:e2e:ui` | Dezelfde tests met een visuele inspector |
| `npm run db:migrate` | Migraties toepassen en winkels aanmaken |

### Browser-tests

`npm test` draait de snelle tests in jsdom. Die zien geen layout, geen
schermbreedte en geen echte valutategels — precies de dingen die in een
browser kapotgaan. Daarom staan er daarnaast tests die écht Chromium starten:

```bash
npx playwright install chromium   # eenmalig
npm run test:e2e
```

Ze controleren onder meer dat geen enkel scherm horizontaal overloopt op een
telefoon, dat bedragen als `€ 1,19` renderen met een komma, en dat de
volledige flow van lege app naar lijst met prijzen werkt. De API draait hierbij
tegen een lege database en een lokale testfeed in `e2e/fixture-feed.mjs`. Die
feed is een testdubbel voor een geautoriseerde bron; de app zelf bevat geen
voorbeeldprijzen.

Op een systeem zonder root (zoals WSL) kan Chromium systeembibliotheken
missen. Dan helpen `npx playwright install-deps chromium` of het lokaal
uitpakken van de benodigde pakketten met `LD_LIBRARY_PATH`.

## Opbouw

```
packages/core   Domeinlogica, geen database of netwerk: eenheden, parser, matching,
                categorieën, aanbiedingsberekening, optimalisatie, weekmenu
apps/api        Fastify + SQLite (Drizzle): databronnen, synchronisatie, productkoppeling,
                lijsten, pantry, menu en alle routes onder /api
apps/web        React + Vite + Tailwind: zeven schermen, responsive vanaf 320 px
```

De kern is bewust vrij van I/O, waardoor de rekenregels los te testen zijn. De API vertaalt
brondata naar die kern, en de webinterface praat alleen met de eigen API — er staat geen api-key in
de browser.

## Databronnen koppelen

Zie [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). Het kortst: per winkel een
`SOURCE_<WINKEL>_BASE_URL` en `SOURCE_<WINKEL>_API_KEY` in `.env`, en de app verwerkt de feed.
Sleutels staan alleen op de server, gaan via een `Authorization`-header en komen nooit in een
antwoord of log terecht.

## Waarom sommige dingen leeg blijven

De app kiest liever niets dan iets verzonnen. Concreet:

| Situatie | Wat je ziet |
| --- | --- |
| Geen bron gekoppeld | Uitleg welke variabelen nodig zijn, geen prijzen |
| Product zonder prijs bij enige winkel | Regel staat er, met "nog geen prijs bekend" |
| Lijst deels zonder prijs | Totaal met waarschuwing; de ontbrekende producten staan erbij |
| Onzekere productkoppeling | Vraagt om bevestiging in plaats van stil te gokken |

## Privacy en veiligheid

- Alles blijft lokaal in `data/boodschappen.db`; er gaat niets naar een eigen server.
  Dat pad ligt altijd naast deze README, ook als je de server vanuit een andere map start.
- Er gaat standaard niets naar een derde partij. De barcode-nakijkbron
  (Open Food Facts) staat uit tot je `OPEN_FOOD_FACTS_ENABLED=true` zet, en daar
  komen nooit prijzen vandaan.
- Sleutels staan in omgevingsvariabelen, nooit in de database of de frontend.
- De browser krijgt nooit een sleutel of een interne endpoint te zien; `GET /api/config` geeft
  alleen aan welke winkels gekoppeld zijn.
