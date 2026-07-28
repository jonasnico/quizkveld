# quizkveld

Finn din neste pubquiz - oversikt over quizkvelder i hele Norge.

Data hentet fra [Norges Quizforbund](https://www.norgesquizforbund.no/arrangementer/finn-din-pubquiz/).

> **Status:** fase 1 - datapipeline. Nettsiden (Astro) kommer i en senere fase.

## Kom i gang

Krever Node >= 22 og pnpm.

```bash
pnpm install
pnpm test
pnpm pipeline all
```

## Pipeline

Pipelinen ligger i `pipeline/` og er helt adskilt fra et framtidig sidebygg. Hvert steg
kan kjøres for seg:

| Kommando | Hva den gjør |
| --- | --- |
| `pnpm pipeline scrape` | Henter kildesiden med undici og skriver den til `raw/latest.html` |
| `pnpm pipeline parse` | Leser `raw/latest.html` med cheerio og oppsummerer radene |
| `pnpm pipeline normalize` | Normaliserer radene og viser fordelinger |
| `pnpm pipeline geocode` | Kjører geokodingsstigen (leverandørene er stubbet i fase 1) |
| `pnpm pipeline build` | Bygger `data/quizzes.json` med overstyringer og sikkerhetssjekker |
| `pnpm pipeline all` | `scrape` → `build` → `geocode` |

Flagg: `--force`, `--min-rows=N`, `--max-id-churn=0.1`, `--skip-scrape`.

### Filer

| Fil | Rolle |
| --- | --- |
| `raw/latest.html` | Rå kildeside. Committes med vilje - git-diffen er slik vi oppdager endringer hos kilden |
| `data/quizzes.json` | Generert utdata: `{ generatedAt, sourceUpdatedAt, venues, quizzes }` |
| `data/overrides.json` | Håndkorrigeringer nøklet på id. Vinner alltid over det som er skrapet |
| `data/geocache.json` | Append-only geocache nøklet på sted-id |
| `pipeline/schema.ts` | Zod-skjemaene. Gjenbrukes av Astro-siden via Content Layer senere |

### Stabile id-er

Alt henger på at id-ene overlever ny skraping, siden både `overrides.json` og
`geocache.json` er nøklet på dem.

- Sted: `slug(kommune + navn)`
- Quiz: `slug(kommune + navn + ukedag + klokkeslett)`

Slugen transliterer æ/ø/å deterministisk (`boelgen-kro`, `tromsoe`). Id-en bruker den
**normaliserte** ukedagen, ikke den rå teksten - ellers ville
`Onsdager (annenhver – høstsesong 2024 fra 28/8 til 4/12)` endret id-en hver gang kilden
retter på en sesong. Kolliderer to quizer likevel, skilles de på gjentakelsestype
(`...-last-of-month`) framfor et posisjonsnummer, slik at rekkefølgen i kildetabellen ikke
har noe å si.

### Gjentakelse

Den norske fritekst-ukedagen tolkes til `{ kind, rrule?, raw }` der `kind` er
`weekly`, `biweekly`, `monthly-nth`, `last-of-month` eller `irregular`. RRULE-strengene
bygges med `rrule`-biblioteket, og originalteksten ligger alltid i `raw`.

Regelen er at vi **aldri gjetter**. Tvetydige formuleringer blir `irregular`:

- `Hver fjerde søndag` kan bety hver fjerde uke *eller* den fjerde søndagen i måneden.
  Det er to forskjellige datoer, så vi velger ingen av dem.
- `Torsdag (eller fredag)` og `Mandag (og fredag)` har ingen entydig ukedag.
- `Fredag (månedlig)` er månedlig, men sier ikke hvilken fredag.

En feil RRULE er verre enn ingen: den sender folk på pub på feil kveld.

### Sikkerhetssjekker

Byggingen stopper med exit-kode 2 hvis

- antall quizer faller under `--min-rows` (standard **250**), eller
- mer enn 10 % av id-ene har endret seg siden forrige `data/quizzes.json`.

Begge tyder normalt på at kilden har lagt om HTML-en. `--force` overstyrer dem for reelle
store endringer. Skjemavalidering kan **ikke** overstyres.

Grensen på 250 er satt ut fra at kilden faktisk har ~350 quizer. Den opprinnelige
antakelsen om 600-900 rader stemte ikke.

### Geokoding

Kilden har verken adresser eller koordinater, bare stedsnavn. `pipeline/geocode.ts`
inneholder ferdig cache-lag og stige-driver; selve oppslagene er stubbet med
`TODO(phase-2)` og implementeres senere i rekkefølgen Kartverket Adresse → Overpass/OSM →
Kartverket Stedsnavn → kommunesentrum.

### Automatisk oppdatering

`.github/workflows/update-data.yml` kjører daglig (04:00 UTC, altså 06:00 i Oslo om
sommeren) og kan startes manuelt. Små endringer committes rett til `main`; slår en
sikkerhetssjekk ut, bygges det på nytt med `--force` og resultatet havner i en pull
request for gjennomgang.

## Kjente svakheter i kildedata

- **`kommune` er egentlig «sted slik en frivillig skrev det».** Kilden har bare en
  by-kolonne, og «Greåker» er et sted i Sarpsborg kommune. Ekte kommuneoppslag kommer med
  geokodingen.
- **Fylkene er de gamle (før 2020):** Sør-Trøndelag, Hedmark, Oppland, Vest-Agder og
  Sogn og Fjordane står fortsatt oppført.
- **Ingen stabile id-er hos kilden**, derfor konstruerer vi våre egne.
- **Noen rader beskriver to quizer** i samme `<tr>` via parallelle `<p>`-blokker i
  klokkeslett- og kategoricellen. De splittes til to quizer.
- Ukedags- og kategoricellene er av og til lenker til Facebook-arrangementer. Lenken
  forkastes; bare lenken i stedscellen brukes som `url`.
