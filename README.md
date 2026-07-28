# quizkveld

Finn din neste pubquiz - oversikt over quizkvelder i hele Norge.

Data hentet fra [Norges Quizforbund](https://www.norgesquizforbund.no/arrangementer/finn-din-pubquiz/).

> **Status:** fase 2b - datapipeline med kommunenormalisering og geokoding.

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
| `pnpm pipeline geocode` | Kjører geokodingsstigen for steder som ikke ligger i cachen |
| `pnpm pipeline build` | Bygger `data/quizzes.json` med overstyringer og sikkerhetssjekker |
| `pnpm pipeline refdata` | Henter referansedata på nytt (kommuneliste, aliastabell, geometri). Kjøres for hånd, aldri i CI |
| `pnpm pipeline all` | `scrape` → `build` → `geocode` |

Flagg: `--force`, `--min-rows=N`, `--max-id-churn=0.1`, `--skip-scrape`.
`refdata` tar `--kommuner`, `--alias` og `--geometri` for å hente bare én av filene.

### Filer

| Fil | Rolle |
| --- | --- |
| `raw/latest.html` | Rå kildeside. Committes med vilje - git-diffen er slik vi oppdager endringer hos kilden |
| `data/quizzes.json` | Generert utdata: `{ generatedAt, sourceUpdatedAt, venues, quizzes }` |
| `data/overrides.json` | Håndkorrigeringer nøklet på id. Vinner alltid over det som er skrapet |
| `data/geocache.json` | Append-only geocache nøklet på sted-id. **Avledet** - kan slettes i sin helhet og bygges opp igjen uten håndarbeid |
| `data/kommuner.json` | Offisiell kommuneliste fra Geonorge: kommunenummer, navn, fylke, punkt i kommunen |
| `data/kommune-alias.json` | Kildens stedsnavn → offisielt kommunenummer, med `resolvedBy` og begrunnelse |
| `data/kommune-geometri.json` | Forenklet polygon per kommune datasettet bruker. Grunnlaget for i-kommune-sjekken |
| `pipeline/schema.ts` | Zod-skjemaene. Gjenbrukes av Astro-siden via Content Layer senere |

De tre kommunefilene er **referansedata**: stabil geografi, ikke ferskvare som quizdata.
De committes og hentes aldri under en vanlig pipeline-kjøring.

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

### Kommune og fylke

Kildens `kommune` er et **stedsnavn slik en frivillig skrev det**, ikke en kommune, og
`fylke` er pre-2020-navn. Begge blir stående urørt - folk søker på «Greåker», og siden
viser det kilden sier. Ved siden av legges det tre valgfrie felter:

| Felt | Innhold |
| --- | --- |
| `kommuneNr` | Offisielt kommunenummer (`3105`) |
| `kommuneName` | Offisielt kommunenavn (`Sarpsborg`) |
| `fylkeNow` | Dagens fylke (`Østfold`, ikke `Viken`) |

Oppslaget skjer i `data/kommune-alias.json`: eksakt treff først, så et normalisert treff
som tåler æøå, casing, whitespace og doble stavemåter, og til slutt en håndsatt oppføring
for tettsteder (`Greåker` → Sarpsborg) og kommuner som ble slått sammen i 2020 (`Rygge` →
Moss, `Stokke` → Sandefjord, `Mandal` → Lindesnes). De håndsatte oppføringene ligger i
`pipeline/kommune-manual.ts` og peker på kommune*navn*, ikke nummer, slik at nummeret
fortsatt er avledet fra den offisielle lista.

De manuelle mappingene kryssjekkes mot kildens eget pre-2020-fylke: havner et stedsnavn i
en kommune som ligger i et annet fylke enn kilden påstår, sier bygget fra. Det er den
sjekken som gjør at tabellen kan stoles på uten at noen leser gjennom alle oppføringene.

### Geokoding

Kilden har verken koordinater eller - for 319 av 322 steder - adresse. Alt hviler derfor
på å matche uformelle stedsnavn mot OSM, og navnematching er bare trygg når den er
avgrenset til riktig område. Rekkefølgen er tvingende:

**aliastabell → kommunegeometri → i-kommune-verifisering → navnematching.**

Stigen i `pipeline/geocode.ts` prøver, i rekkefølge:

1. **Kartverket Adresse** - for de få stedene som faktisk har en adresse.
2. **Overpass/OSM** - hovedkilden. Én spørring per kommune (ikke per sted) mot
   `amenity=pub|bar|cafe|restaurant|nightclub` m.fl., avgrenset av kommunens bounding box
   fra vår egen geometri.
3. **Kartverket Stedsnavn** - bare eksakte treff.
4. **Kommunesentrum** - siste utvei, alltid `geoConfidence: "low"`, og bare i kommuner med
   få steder. I Oslo ville sentroiden stablet dusinvis av steder på ett punkt, så der blir
   stedene heller stående uten koordinat.

#### Verifisering

En feil koordinat er verre enn ingen: den tegnes som en selvsikker nål brukeren ikke kan
se er gal. Hvert treff må gjennom:

- **Norge-boksen** (lat 57-72, lon 4-32), med en egen boks for Svalbard som faller utenfor.
- **Punkt-i-kommune** mot polygonet i `data/kommune-geometri.json`, med en toleranse på
  1500 m som dekker både forenklingsfeil og steder som ligger klint opp i en kommunegrense.

Sju stedsnavn går igjen i flere kommuner (`O'Learys`, `Samfundet`, `Dirty Nelly` m.fl.).
Et treff som faller utenfor forventet kommune **forkastes** - det nedgraderes ikke til
`medium`. Navne-scoreren nekter også å velge når to kandidater scorer likt og ligger mer
enn 400 m fra hverandre.

`geoConfidence` settes ærlig: eksakt navnetreff i riktig kommune = `high`, uskarpt treff i
riktig kommune = `medium`, sentroide = `low`.

#### Drift

Geokoding er et eget CLI-steg og rører bare steder uten cache-oppføring. Kjøringen er
resumerbar - cachen skrives etter hvert treff, ikke til slutt - og respekterer Overpass
som den dugnadstjenesten den er: ~1 forespørsel/sekund, beskrivende User-Agent med
kontakt-URL, og eksponentiell backoff på 429/504. I den daglige workflowen er steget
`continue-on-error` med timeout, slik at en Overpass-nedetid ikke kan velte datajobben
eller blokkere en deploy.

Trenger et sted en ekte håndsatt koordinat, hører den hjemme i `data/overrides.json` med
`geoSource: "manual"` - aldri i cachen.

### Automatisk oppdatering

`.github/workflows/update-data.yml` kjører daglig (04:00 UTC, altså 06:00 i Oslo om
sommeren) og kan startes manuelt. Små endringer committes rett til `main`; slår en
sikkerhetssjekk ut, bygges det på nytt med `--force` og resultatet havner i en pull
request for gjennomgang.

## Kjente svakheter i kildedata

- **`kommune` er egentlig «sted slik en frivillig skrev det».** Kilden har bare en
  by-kolonne, og «Greåker» er et sted i Sarpsborg kommune. Løst i fase 2b: kildeverdien
  står urørt, og `kommuneNr`/`kommuneName` legges ved siden av.
- **Fylkene er de gamle (før 2020):** Sør-Trøndelag, Hedmark, Oppland, Vest-Agder og
  Sogn og Fjordane står fortsatt oppført. `fylkeNow` gir dagens fylke.
- **Ett stedsnavn lar seg ikke slå opp i det hele tatt:** `Sandnesseter` (oppført i
  Akershus) finnes ikke i Kartverkets stedsnavnregister i noen stavemåte. Det ser ut som
  en skrivefeil hos kilden og hører hjemme i en e-post til dem, ikke i en overstyring her.
- **Ingen stabile id-er hos kilden**, derfor konstruerer vi våre egne.
- **Noen rader beskriver to quizer** i samme `<tr>` via parallelle `<p>`-blokker i
  klokkeslett- og kategoricellen. De splittes til to quizer.
- Ukedags- og kategoricellene er av og til lenker til Facebook-arrangementer. Lenken
  forkastes; bare lenken i stedscellen brukes som `url`.
