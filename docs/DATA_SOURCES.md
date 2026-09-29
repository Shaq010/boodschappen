# Databronnen

Dit document legt uit waarom de prijsfunctie in deze app leeg blijft zonder koppeling, hoe je een
officiële bron instelt, en welke afspraken de feed-adapter hanteert.

## Uitgangspunt: geen openbare prijs-API

Voor de vier winkels in deze app geldt hetzelfde:

| Winkel | Publieke prijs-/aanbiedings-API | Automatisch ophalen van de website |
| --- | --- | --- |
| Lidl | Nee | Niet toegestaan |
| Albert Heijn | Nee | Niet toegestaan |
| Dirk | Nee | Niet toegestaan |
| Kruidvat | Nee | Niet toegestaan |

Deze winkels zelf geven dus geen data vrij. Wel bestaat er een **geautoriseerde prijsbron die
data over deze winkels aanbiedt**: [PrijsProfeet](https://www.prijsprofeet.nl/api). Dat is geen
 scraping van de winkels, maar een betaald of gratis abonnement op een API. Zie
[PrijsProfeet als bron](#prijsprofeet-als-bron).

Deze app doet dan ook twee dingen níét:

1. **Geen scraping.** De websites van deze winkels verbieden geautomatiseerd ophalen van hun
   prijzen en aanbiedingen. Die code zit bewust niet in deze repository.
2. **Geen schattingen.** Er wordt nooit een prijs berekend, gemiddeld of gegokt. Ontbreekt er een
   prijs, dan blijft het veld leeg en zegt de app waarom.

Wat de app wél doet: een officiële, geautoriseerde feed aansluiten. Dat is de enige manier waarop
de prijsvergelijking met echte cijfers werkt.

## Instellen

De snelste route is PrijsProfeet hieronder; die dekt drie van de vier winkels met één sleutel.

Per winkel met een eigen feed zet je twee variabelen in `.env` (voor de winkel `albert_heijn`):

```bash
SOURCE_ALBERT_HEIJN_BASE_URL=https://jouw-feed.example/ah
SOURCE_ALBERT_HEIJN_API_KEY=jouw-token
# Optioneel; standaard is de waarde van CACHE_TTL_SECONDS:
SOURCE_ALBERT_HEIJN_TTL_SECONDS=900
```

Na het herstarten van de API verschijnt de winkel in Instellingen als "Gekoppeld". Zonder
variabelen blijft de winkel "Niet gekoppeld" en zegt de app welke er ontbreken.

### Alle variabelen

De volledige lijst staat in `.env.example`. De variabelen die hier een rol spelen:

| Variabele | Betekenis |
| --- | --- |
| `SOURCE_<WINKEL>_BASE_URL` | Basis-URL van de geautoriseerde feed; leeg laten betekent "niet gekoppeld" |
| `SOURCE_<WINKEL>_API_KEY` | Token, via een `Authorization`-header meegestuurd |
| `SOURCE_<WINKEL>_HEADERS` | Extra headers, bv. `X-Tenant: mijnbedrijf` |
| `SOURCE_<WINKEL>_TTL_SECONDS` | Eigen cachetijd voor deze winkel |
| `ALLOW_NETWORK` | `false` blokkeert alle uitgaande verzoeken; handig offline |
| `CACHE_TTL_SECONDS` | Standaard levensduur van de cache |
| `DATABASE_FILE` | Pad van de SQLite-database (standaard `./data/boodschappen.db`, relatief aan de projectroot) |
| `CORS_ORIGIN` | Waar de webinterface vandaan mag komen |

`<WINKEL>` is de slug van de winkel: `LIDL`, `ALBERT_HEIJN`, `DIRK`, `KRUIDVAT`.

De API leest `.env` bij het opstarten in. Wat al in je omgeving staat, wint van wat in `.env`
staat, dus ook `SOURCE_LIDL_API_KEY=... npm start` werkt.

## PrijsProfeet als bron

Eén API-sleutel dekt Lidl, Albert Heijn en Dirk. Kruidvat levert PrijsProfeet niet: het is een
drogist en geen supermarkt. Voor Kruidvat blijft de bron dus ongekoppeld, en dat zegt de app.

```bash
PRIJSPROFEET_API_KEY=jouw-sleutel
# Optioneel; dit is de standaardwaarde:
PRIJSPROFEET_BASE_URL=https://www.prijsprofeet.nl/api/v1
PRIJSPROFEET_USER_AGENT=BoodschappenApp/1.0 (https://jouw-domein.nl)
```

Een eigen `SOURCE_<WINKEL>_BASE_URL` heeft **voorrang** op PrijsProfeet. Heb je ooit een directe
winkelkoppeling, dan wint die.

### Wat deze bron wel en niet levert

| | Gratis plan | Pro (€49/mnd) |
| --- | --- | --- |
| Actieprijzen van Lidl, AH, Dirk en 7 andere ketens | Ja | Ja |
| Cross-retailer matching op EAN | Nee | Ja |
| Reguliere schapprijzen (buiten acties om) | Nee | Ja |
| Prijsverloop over de maanden | Nee | Ja |

Praktisch: op het gratis plan ziet de app alleen wat **deze week in de aanbieding** is. Om te weten
wat een product buiten een actie kost, en om hetzelfde product over winkels heen te vergelijken, is
Pro nodig. De app doet die vergelijking ook zelf, op EAN, maar mist dan de schapprijzen.

### Wat de adapter ermee doet

- **Alleen acties van vandaag.** Ongeveer een derde van de catalogus begint pas later
  (`promotion_status: "upcoming"`). Die prijzen bestaan vandaag nog niet op het schap en worden
  geweigerd, met reden, op de statuspagina. De overige rijen worden wél opgeslagen.
- **Paginering per winkel.** Elke winkel wordt met `?retailer=` opgehaald, zodat de sleutel niet
  drie keer belast wordt. Een volledige sync van drie winkels is ongeveer 45 verzoeken.
- **Bundels.** `price` is de stukprijs; `multi_buy_quantity` en `multi_buy_price` zijn het pakket.
  "3 voor €0,89" wordt een pakket van 3, waarna de kern uitrekent dat je voor één stuk het hele
  pakket betaalt.
- **Verpakking.** De inhoud komt uit het veld `quantity` ("100 g"). Het veld `unit` is de
  vergelijkingsseenheid ("kg") en wordt nooit als verpakking genomen.
- **Onleesbare verpakkingen blijven onbekend.** "4-pack" is geen maat. Het aantal blijft leeg in
  plaats van te gokken, zodat het product niet als vier onbekende porties wordt beoordeeld.
- **Geschatte einddatum.** Komt `valid_until_estimated` mee, dan staat dat in de omschrijving.
- **Ledenprijzen.** Die staan apart in `loyalty_price` en worden nooit als gewone prijs behandeld.
  Ons contract kent nog geen "goedkoper met kaart", dus de prijs met kaart staat in de omschrijving
  in plaats van verdwijnen.

### Voorwaarden van de bron

- Op het **gratis plan is bronvermelding verplicht**. Daarom staat er onderaan elke pagina een
  verwijzing naar prijsprofeet.nl. Die moet blijven staan zolang je de gratis sleutel gebruikt.
- Prijzen zijn indicatief en exclusief btw. De app zegt dat ook.
- Plaats je eigen naam in `PRIJSPROFEET_USER_AGENT`. De bron vraagt daarom en kan je dan bij een
  wijziging in de data waarschuwen.
- De gratis sleutel geldt 150 verzoeken per minuut, geteld op je sleutel in plaats van op je
  serveradres. Wie de sleutel in een gedeelde app stopt, deelt die limiet dus.
- Verwacht wordt dat je de data niet doorverkoopt. Wil je de app echt aan anderen geven, lees dan
  de [API-voorwaarden](https://www.prijsprofeet.nl/api-voorwaarden) of neem een Pro- of
  Business-plan.

## Het feedformaat

De ingebouwde adapter (`GenericFeedAdapter`) haalt twee lijsten op:

```
GET {BASE_URL}/offers
GET {BASE_URL}/prices
```

Beide met `Accept: application/json` en `Authorization: Bearer {API_KEY}`.

### `/offers`

```json
{
  "offers": [
    {
      "id": "ah-2026-0042",
      "gtin": "8710398503968",
      "title": "Coca-Cola regular 1,5 l",
      "description": "Fles van 1,5 liter",
      "kind": "price_drop",
      "offerPrice": 2.25,
      "regularPrice": 2.79,
      "packQuantity": 1500,
      "packUnit": "ml",
      "conditions": { "requiresLoyaltyCard": false, "maxPerPerson": 6 },
      "validFrom": "2026-01-05",
      "validUntil": "2026-01-18"
    }
  ]
}
```

| Veld | Verplicht | Toelichting |
| --- | --- | --- |
| `id` | ja | Uniek binnen de winkel; bepaalt de koppeling bij latere syncs |
| `title` | ja | Productnaam zoals de winkel hem noemt |
| `kind` | ja | Zie tabel hieronder |
| `storeProductId` | nee | Eigen id van de winkel; anders wordt er één afgeleid uit de titel |
| `offerPrice` | bijna altijd | Actieprijs in euro |
| `regularPrice` | bij | Normale prijs, voor het kortingpercentage |
| `gtin` | nee | Barcode; de betrouwbaarste manier om te koppelen |
| `packQuantity` / `packUnit` | nee | Inhoud van de verpakking, bv. `1500` en `ml` |
| `conditions` | nee | Voorwaarden, zie hieronder |
| `validFrom` / `validUntil` | nee | ISO-datum (`YYYY-MM-DD`) |

### `/prices`

```json
{
  "prices": [
    {
      "id": "ah-p-8812",
      "gtin": "8710398503968",
      "title": "Coca-Cola regular 1,5 l",
      "price": 2.79,
      "packQuantity": 1500,
      "packUnit": "ml",
      "observedAt": "2026-01-05T09:00:00Z"
    }
  ]
}
```

Dit is de gewone prijs zonder actie. Daarmee kan de app het verschil tussen normaal en actie
bepalen, ook als een aanbieding alleen als actie wordt aangeboden.

### Soorten aanbiedingen

`kind` bepaalt hoe de app de prijs berekent. Onbekende waarden worden afgewezen, niet geraden.

| `kind` | Betekenis | Vereist extra veld |
| --- | --- | --- |
| `price_drop` | Gewoon lagere prijs | — |
| `multipack` | Korting bij meerdere stuks | `packQuantity` of `packUnit` |
| `second_half` | Tweede halve prijs | `packQuantity` (2 eenheden) |
| `bundle` | Bundelprijs | `packQuantity` |
| `loyalty` | Alleen met klantenkaart | `conditions.requiresLoyaltyCard: true` |
| `min_quantity` | Vanaf een aantal stuks | `conditions.minQuantity` |
| `per_volume` | Korting per liter of kilo | `packQuantity` en `packUnit` |
| `cashback` | Korting bij betalen | `conditions.instantSavings` |

### Voorwaarden

| Veld | Betekenis |
| --- | --- |
| `requiresLoyaltyCard` | Alleen geldig met de loyaltykaart van de winkel |
| `loyaltyCardName` | Naam van die kaart, bv. `Mijn AH` |
| `discountPercent` | Korting in procenten bij gebruik van de kaart |
| `minQuantity` | Aantal waarvoor de prijs geldt |
| `maxPerPerson` | Limiet per persoon |
| `bundleSize` | Aantal verpakkingen per actie (bv. `2` voor "2 voor 3,50") |
| `bundlePrice` | Prijs van die actie |
| `secondUnitDiscount` | Korting op het tweede artikel (`0.5` = tweede halve prijs) |
| `instantSavings` | Directe korting bij afrekenen |
| `giftValue` | Waarde van het cadeau |

Elke voorwaarde komt zichtbaar naast het bedrag te staan. Een prijs die alleen met een
klantenkaart geldt, is niet hetzelfde als een prijs die voor iedereen geldt, en dat verschil mag je
niet pas bij de kassa ontdekken.

Een voorwaarde met een naam die hier niet staat, wordt **niet genegeerd**: de aanbieding wordt
geweigerd en verschijnt in het sync-overzicht met de reden. Een onbekende sleutel weglaten zou
bijvoorbeeld betekenen dat "alleen met klantenkaart" verdwijnt en de prijs voor iedereen lijkt te
gelden. Liever een regel minder dan een verkeerd bedrag.

## Hoe prijzen worden berekend

Per product en per winkel berekent de app:

- **mandprijs** — wat je voor jouw hoeveelheid betaalt, inclusief hoeveel extra's je erbij krijgt;
- **eenheidsprijs** — de mandprijs gedeeld door het aantal basiseenheden, zodat 1 liter en 1 kilo
  vergelijkbaar zijn;
- **korting** — verschil met de gewone prijs, plus het percentage;
- **waarschuwingen** — de voorwaarden die bij de prijs gelden.

Daarna kiest de optimizer:

1. **goedkoopste totaal** — de laagste som over alle winkels samen;
2. **alles bij één winkel** — het laagste totaal bij één winkel, ook als dat iets duurder is;
3. **zo min mogelijk winkels** — eerst het aantal winkels, daarna de prijs.

Een winkelsamenstelling is alleen geldig als elk product daar verkrijgbaar is. Ontbreekt er een
product, dan staat dat erbij en telt het product niet mee in het totaal. Zo blijft een totaal
verantwoordbaar.

## Waarom een product niet altijd gekoppeld wordt

De koppeling van jouw "cola" naar een winkelproduct gaat in deze volgorde:

1. **GTIN** — dezelfde barcode, dan zit je zeker goed;
2. **naam, zonder verpakking** — winkelproducten heten volledig ("Melk 1 l", "Coca-Cola regular
   1,5 l"), dus maatvoering en verpakkingswoorden worden eerst weggehaald. Daarna geldt een drempel
   van 92% gelijkheid en een synoniemenboek, zodat "melk" de producten "Melk 1 l" en "Volle melk
   1 l" herkent;
3. **twijfel** — dan wordt er niets stilzwijgend gekoppeld. De app vraagt om bevestiging, en je kunt
   zelf een extra naam toevoegen die voortaan wél klopt.

Er wordt extra voorzichtig omheen twee dingen heen gewerkt:

- **Varianten.** "cola" is niet hetzelfde als "Coca-Cola zero" of "Coca-Cola regular". Zolang de
  variantwoorden verschillen, wordt het een vraag in plaats van een koppeling — ook als de rest van
  de naam wél exact klopt.
- **Packformaat.** "Melk 1 l" en "Melk 3 l" noemen hetzelfde product maar zijn niet hetzelfde
  product. Bij zo'n gelijkspel vraagt de app welke je bedoelde.

Een naam die je zelf hebt bevestigd weegt het zwaarst. Zodra je "cola" aan "Coca-Cola regular" hebt
gekoppeld, is dat vanaf dan jouw antwoord en geen vraag meer.

Twijfel is hier een feature. Een verkeerd gekoppeld product levert een verkeerd bedrag op, en dat
is lastiger te herkennen dan een ontbrekend bedrag.

## Privacy bij het ophalen

Zonder gekoppelde prijsbron gaat er niets naar een derde partij. Er zijn twee
uitzonderingen die je zelf aanzet:

1. **Een prijsbron.** Met `PRIJSPROFEET_API_KEY` of een `SOURCE_<WINKEL>_BASE_URL`
   vraagt de app prijzen op. Die aanvraag gaat naar die bron. Het gaat om een
   endpoint en de productnamen die daarbij horen; er wordt nooit iets over jouw
   lijst, je adres of je klantenkaart meegestuurd. De API-sleutel staat in een
   header en komt nooit in een log of in de interface terecht.
2. **Open Food Facts.** Met `OPEN_FOOD_FACTS_ENABLED=true` kijkt de app een
   onbekende barcode na. Daar komen alleen productnaam en barcode vandaan, nooit
   prijzen, en alleen als je product nog geen naam heeft. Standaard staat dit uit.

Met `ALLOW_NETWORK=false` gaat er helemaal niets het internet op. De app werkt dan
verder gewoon door: lijsten, menu, voorraad en instellingen blijven beschikbaar,
en de prijzen blijven leeg.

## Wat je zelf kunt doen zonder bron

- Lijsten, weekmenu en voorraad invullen — die werken volledig offline.
- Producten bevestigen en extra namen toevoegen, zodat de koppeling bij een latere sync meteen
  klopt.
- Instellingen bekijken om te zien welke winkels gekoppeld zijn en welke variabelen ontbreken.

De app blijft dan overal zeggen dat er geen prijzen zijn, in plaats van iets te tonen dat niet
klopt.
