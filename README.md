# quizkveld

Finn din neste pubquiz - oversikt over quizkvelder i hele Norge.

Data hentet fra [Norges Quizforbund](https://www.norgesquizforbund.no/arrangementer/finn-din-pubquiz/).

> **Status:** fase 2a - datapipeline og nettsted. Geokoding, kart og «nær meg» kommer i
> fase 2b.

## Kom i gang

Krever Node >= 22.12 (Astro 7-kravet) og pnpm.

```bash
pnpm install
pnpm test        # pipeline + nettsted
pnpm dev         # nettstedet på http://localhost:4321/quizkveld/
pnpm build       # statisk bygg til dist/ + lenkesjekk
pnpm preview     # serverer dist/ med riktig base-sti
pnpm pipeline all
```

`pnpm typecheck` kjører begge halvdelene: `tsc` mot `tsconfig.pipeline.json` for
pipelinen, og `astro check` for `src/`.

## Nettstedet

Astro-prosjektet ligger i `src/` og er helt adskilt fra `pipeline/`. Den eneste koblingen
går én vei: `src/` importerer `pipeline/schema.ts`, `pipeline/slug.ts` og
`pipeline/paths.ts`. Ingenting i pipelinen vet at nettstedet finnes.

| Fil | Rolle |
| --- | --- |
| `src/content.config.ts` | Content Layer: leser `data/quizzes.json` og validerer med `QuizDataSchema` |
| `src/lib/date.ts` | Sivil dato og ukedag i **Europe/Oslo** |
| `src/lib/occurrence.ts` | Om en quiz treffer en gitt dato, og hvor sikkert |
| `src/lib/place.ts` | Slugger for sted og fylke, med deterministisk kollisjonsløsning |
| `src/lib/model.ts` | Kobler quiz til sted, sorterer, grupperer, teller |
| `src/lib/format.ts` | All norsk visningstekst ett sted |
| `src/scripts/filters.ts` | Klientfilter som skjuler kort som allerede er sendt ut |

Sider: `/` (i kveld), `/i-morgen/`, `/denne-uka/`, `/steder/`, `/sted/<sted>/`,
`/fylke/<fylke>/`, `/pub/<sted-id>/`, `/om/`. ~450 statiske sider totalt.

### Tidssone

«I kveld» regnes alltid i Europe/Oslo med `Intl`, aldri med `new Date().getDay()`. CI
bygger i UTC, så en naiv dato ville vist feil kveld etter kl. 22 norsk tid om sommeren.
Datoene er `YYYY-MM-DD`-strenger og all aritmetikk går via UTC-midnatt, som ikke har
sommertid å snuble i.

### Hvor sikkert vises en quiz

| `recurrence.kind` | Visning |
| --- | --- |
| `weekly`, `monthly-nth`, `last-of-month` | Datofestet |
| `biweekly` | Datofestet, men merket «annenhver uke - sjekk selv». RRULE-en har ingen DTSTART, så vi vet ukedagen, ikke hvilken uke i syklusen |
| `irregular` | Aldri datofestet. Egen seksjon nederst med `recurrence.raw` ordrett |

De 20 uregelmessige quizene (5 uten ukedag) forsvinner aldri stille - det finnes en test
som holder på det. `time: null` (16 quizer) vises som «tidspunkt ikke oppgitt» og sorteres
sist innenfor dagen, aldri som 00:00.

`categoryNorm` er en array, så kategorifilteret matcher **inneholder**, ikke likhet.
Sjangertellingene summerer derfor til mer enn antall quizer, og UI-et sier det rett ut.

### Filtrering uten rammeverk

Serveren rendrer hvert kort; `src/scripts/filters.ts` skrur bare `hidden` av og på og
speiler valget i query-strengen (`?sted=Asker&ukedag=fredag&kategori=musikk`). Uten
JavaScript får man hele lista, som fortsatt er brukbar.

## Hosting

Nettstedet ligger på GitHub Pages: <https://verdensherredomme.github.io/quizkveld>.

`astro.config.mjs` har `site` og `base` som to navngitte konstanter. Bytte til eget domene
er én endring hver pluss en CNAME-fil:

```js
const SITE = "https://quizkveld.no";
const BASE = "/";
```

...og `public/CNAME` med innholdet `quizkveld.no`.

Alle interne lenker går gjennom `href()` i `src/lib/url.ts`, som prefikser
`import.meta.env.BASE_URL`. `scripts/check-base.mjs` kjører etter hvert bygg og feiler
hvis en lenke i `dist/` har glemt base-stien - det er den klassiske prosjekt-Pages-fella.

`compressHTML: true` er satt med vilje: Astro 7 bruker JSX-regler for mellomrom som
standard, og de spiser mellomrommet mellom et ord og en lenke på neste linje.

### Deploy

`.github/workflows/deploy.yml` bygger og deployer. Den trigges av push til `main`,
manuelt, **og** av at «Oppdater quizdata» blir ferdig. Det siste er ikke pynt: pushes
gjort med `GITHUB_TOKEN` trigger ikke nye `push`-workflows, så uten `workflow_run` ville
ferske data aldri blitt publisert. Workflowen deklarerer `permissions:` eksplisitt, siden
organisasjonen står på read-only som standard.

## Pipeline

Pipelinen ligger i `pipeline/` og er helt adskilt fra sidebygget. Hvert steg
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
| `pipeline/schema.ts` | Zod-skjemaene. Gjenbrukes av nettstedet via Content Layer |

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

### Kategori

`categoryNorm` er en **array**, ikke én verdi. 23 av 352 rader navngir mer enn én sjanger
(`Allmenn/film/musikk`, `Musikk og film`, `Live musikk/Allmenn quiz`), og å kollapse dem
til én skjulte 23 ekte musikkquizer for et musikkfilter. Rekkefølgen er fast
(allmenn → musikk → sport → film → annet), ikke rekkefølgen sjangrene står i teksten, så
outputen er deterministisk. Originalteksten ligger alltid i `category`.

Gjenkjenningen kjører mot hele strengen, ikke mot separator-delte biter. Skilletegnene er
ikke til å stole på: `Allmenn – med påfølgende musikkquiz` og `Allmenn med musikk` navngir
to sjangre uten noe skilletegn i det hele tatt.

`seriespill` er en seriespill-form for allmennquiz og skal **ikke** trigge `film` - det er
en felle det finnes egen test for.

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

**Neste steg for de irregulære:** 12 av de 20 irregulære har ukedag, men sier ikke hvilken
uke i måneden (`Fredag (månedlig)`, `Mandag (én gang per måned)`, …). Det er den største
enkeltgruppa og den mest lønnsomme å håndkuratere først i `data/overrides.json` - de
mangler bare uke-nummeret. Strengene er listet i `_note` i den fila.

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
`TODO(phase-2)` og implementeres i fase 2b i rekkefølgen Kartverket Adresse →
Overpass/OSM → Kartverket Stedsnavn → kommunesentrum. Nettstedet nevner derfor verken
avstand, kart eller «nær meg» ennå - `lat`/`lon` er tomme på alle 322 steder.

### Automatisk oppdatering

`.github/workflows/update-data.yml` kjører daglig (04:00 UTC, altså 06:00 i Oslo om
sommeren) og kan startes manuelt. Små endringer committes rett til `main`; slår en
sikkerhetssjekk ut, bygges det på nytt med `--force` og resultatet havner i en pull
request for gjennomgang. Når den committer, trigger den deploy-workflowen via
`workflow_run`.

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
