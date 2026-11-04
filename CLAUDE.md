# Padelschema: uitleg voor Claude Code

Antwoord altijd in het Nederlands. De app is voor een groep van zes vrienden die padelen (Marcel, Mark, Ronald, Sander, Dennis, Robert). Het is geen bedrijfsproject: houd het eenvoudig en voorspelbaar.

## Wat is dit
Een webapp (PWA) met rooster, uitslagen, KingKong-klassement, chat, baanboekingen, weer en pushmeldingen. Eén bestand voor de app, kleine serverfuncties op Vercel, Firebase Realtime Database als opslag. Live op https://padel-schema-waalwijk.vercel.app. Elke push naar `main` wordt door Vercel vanzelf live gezet.

## Bestanden
- `index.html`: de hele app (HTML, CSS en JavaScript). Bovenaan het script staat `APP_VERSION`, het enige versienummer.
- `padel-regels.js`: de ENIGE plek voor het speelschema, de telregels, het podium en de startdatum van cyclus 1. De app laadt het met een scripttag, de server importeert het. Alleen gewoon JavaScript, geen DOM, geen Firebase.
- `lib/padel.js`: hulpfuncties voor de server (database, tijd, push versturen).
- `api/login.js`: controleert de pincode en geeft een Firebase-inlogbewijs.
- `api/notify.js`: stuurt een pushmelding bij een chat- of systeembericht.
- `api/match-reminder.js`, `api/cron-weather.js`, `api/result-reminder.js`, `api/kingkong-winnaar.js`: cron-jobs (cron-job.org roept ze aan met de header `x-cron-secret`).
- `api/test-push.js`: testmelding naar alleen de eigen toestellen van Robert (verificatie met het `robert`-recht; werkt ook als de push voor de groep uit staat).
- `firebase-rules.json`: kopie van de databaseregels. Vercel zet die NIET live; de eigenaar plakt ze zelf in de Firebase-console.
- `firebase-messaging-sw.js`, `manifest.json` en de iconen horen bij de pushmeldingen en de PWA.

## Regels voor wijzigingen
1. **Versienummer:** verhoog `APP_VERSION` in `index.html` bij elke wijziging aan `index.html` of `padel-regels.js`. Zonder nieuw nummer verversen telefoons niet. Titel en voettekst nemen het nummer vanzelf over.
2. **Telregels of schema:** pas alleen `padel-regels.js` aan, nooit een kopie ergens anders.
3. **Samenhorende bestanden in één commit** (bijvoorbeeld `padel-regels.js` met `index.html`).
4. **Geen geheimen in de repository.** De pincodes (`APP_PIN`, `ROBERT_PIN`), `CRON_SECRET` en de `FIREBASE_*`-variabelen staan alleen in Vercel. Schrijf nooit een waarde in een bestand, commit of chat.
5. **Databaseregels:** wijzig `firebase-rules.json` alleen als voorstel en zeg erbij dat de eigenaar ze handmatig in Firebase moet plakken. Chatberichten mogen maximaal 2000 tekens zijn (app en regels moeten daarin gelijk blijven).
6. **Controleer syntax** na elke wijziging: draai `node --check` op de JavaScript-bestanden, en op het script uit `index.html`.

## Hoe de app zich gedraagt (niet stukmaken)
- Inloggen gaat via `api/login.js` (pincode op de server, Firebase custom token met `lid` en voor Robert `robert`). Er is geen anonieme login meer. Na 30 dagen vraagt een apparaat weer om de code.
- Elke wijziging van het rooster, een uitslag, boeking, afmelding of weer openen/afgelasten vraagt eerst om bevestiging met `bevestigDialoog(...)` en post daarna een systeembericht (met push). Gebruik voor nieuwe vragen `bevestigDialoog`, nooit `confirm()` of `alert()`.
- Pushmeldingen kunnen door Robert aan/uit worden gezet (`padelData/settings/pushGloballyEnabled`). Alle cron-jobs en `notify.js` moeten dat blijven respecteren.
- Het KingKong-podium wordt 30 minuten na de laatste uitslag bekendgemaakt, of 3 dagen na afloop van de cyclus (vangnet). De app en de server doen hetzelfde, met een transaction zodat er nooit een dubbel bericht komt.
- Games tellen alleen voor een vaste speler op zijn eigen oorspronkelijke slot. Invallers tellen nergens mee. Wijzig dit alleen als de eigenaar het vraagt.

- Afmelden voor een wedstrijd zet een invalvraag in `padelData/invallers/<week>_<slot>/<speler>`. In de wedstrijdkaart verschijnt een groen blokje met de knop "Ik kan invallen"; de eerste die tikt wint (transaction) en vervangt de afgemelde speler in het rooster. Bij aanmelden verdwijnt een openstaande vraag.
- Onderaan de pagina staat een rij "Beheer" met "Testmelding naar mij" en "Back-up downloaden". Die is alleen zichtbaar voor Robert met het `robert`-recht. De back-up bevat geen foto's/bijlagen.

## Telefoon eerst
De meeste spelers gebruiken de app op een telefoon (320 tot 414 pixels breed). Op de wedstrijdkaarten mag geen regel naar de volgende regel springen (dag/tijd en weerbericht passen zichzelf aan met `fitOneLineRows`). Controleer nieuwe schermen op smalle breedtes en gebruik de bestaande stijl (kaarten met afgeronde hoeken, blauwe en gele popups).

## Wat de eigenaar zelf doet
Pushmeldingen echt testen op toestellen, de Firebase-regels plakken, geheimen in Vercel zetten, en de back-up van de database maken. Stel dit voor, doe het niet zelf.
