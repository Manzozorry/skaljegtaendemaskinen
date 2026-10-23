# Skal jeg tænde maskinen?

En side med ét spørgsmål og ét svar: skal du tænde opvaskeren (eller vaskemaskinen, tørretumbleren, elbilladeren) nu, eller vente til strømmen er billigere?

Svaret regnes ud fra de rigtige priser pr. kvarter: spotpris + nettarif fra dit netselskab + elafgift + Energinets tariffer + moms. Elselskabets eget tillæg er ikke med, men det er det samme hele døgnet og ændrer derfor ikke, hvornår det er billigst.

## Sådan virker det

- `scripts/update.mjs` henter priser fra [Energi Data Service](https://www.energidataservice.dk/) (datasættene `DayAheadPrices` og `DatahubPricelist`) og skriver:
  - `site/data/latest.json` – priser og tariffer, som siden regner på
  - `site/data/historik.json` – hvad opvaskeren har sparet siden start
  - `site/cal/<netselskab>-<maskine>.ics` – kalenderabonnementer
- `.github/workflows/opdater.yml` kører scriptet hver dag efter kl. 13, når morgendagens priser er udkommet, gemmer data i repoet og udgiver `site/` på GitHub Pages.
- Siden (`site/`) er ren HTML, CSS og JavaScript. Ingen server, ingen cookies, ingen eksterne skrifttyper.
- `site/beregn.js` bruges både af siden og af scriptet, så de regner ens.
- Siden findes på dansk og engelsk. Sproget vælges efter browseren, kan skiftes med DA/EN-knappen og kan tvinges med `?lang=en`. Alle tekster står i `site/tekster.js`, og kalenderne findes i `site/cal/` (dansk) og `site/cal/en/` (engelsk).

## Opsætning (én gang)

1. **Settings → Pages → Build and deployment → Source:** vælg **GitHub Actions**.
2. **Actions → Opdater priser og udgiv → Run workflow** for at hente de første priser.
3. Siden ligger nu på `https://manzozorry.github.io/skaljegtaendemaskinen/`.

## Ting du selv skal sætte ind

- **Buy Me a Coffee-link:** øverst i `site/app.js`, konstanten `KILOWATTTIME_LINK`. Knappen er skjult, indtil der står et link.
- **Eget domæne:** Settings → Pages → Custom domain, og peg domænet på GitHub Pages i DNS.

## Kør lokalt

```sh
npm test            # kører scriptet på testdata i test/fixtures (ikke rigtige priser)
npm run opdater     # henter rigtige priser (kræver internetadgang til api.energidataservice.dk)
python3 -m http.server -d site 8000
```

Testdata i `test/fixtures` er opdigtede priser i samme format som Energi Data Service. Radius' tariffer og afgifterne er rigtige værdier for 2026.

## Netselskaber

Øverst i listen står to gennemsnit: øst og vest for Storebælt. Det er et simpelt gennemsnit af tarifferne for netselskaberne i området, og det er standardvalget, så man kun behøver at vide, hvilken side af Storebælt man bor på. Vælger man sit eget netselskab, bliver svaret præcist.

Listen står i `scripts/netselskaber.json` (GLN-nummer og tarifkode for nettarif C). Et netselskab bliver automatisk sprunget over, hvis der ikke findes en gyldig tarif, eller hvis tariffen ikke ligner en tidstarif (billigst om natten, dyrest kl. 17–21). Det sidste betyder som regel, at tarifkoden er forældet. Pr. oktober 2026 gælder det Aal El-Net, Elinord, FLOW Elnet, Forsyning Elnet og Ikast El Net. Tarifkoderne stammer fra Home Assistant-integrationen [MTrab/energidataservice](https://github.com/MTrab/energidataservice).

## Skrifttyper

Archivo og IBM Plex Mono, begge under SIL Open Font License (se `site/fonts/`).
