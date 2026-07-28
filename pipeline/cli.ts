#!/usr/bin/env node
import fs from "node:fs/promises";
import {
  DEFAULT_MAX_ID_CHURN,
  DEFAULT_MIN_ROWS,
  SafetyRailError,
  build,
  writeQuizData,
} from "./build.js";
import { GeoCache, createProviders, crossKommuneCollisions, runGeocode } from "./geocode.js";
import { loadKommuneGeometry } from "./kommune.js";
import { normalizeRows } from "./normalize.js";
import { parse } from "./parse.js";
import { PATHS } from "./paths.js";
import { runRefdata, type RefdataOptions } from "./refdata.js";
import { scrape } from "./scrape.js";
import type { QuizData } from "./schema.js";

type Step = "scrape" | "parse" | "normalize" | "refdata" | "geocode" | "build" | "all";
const STEPS: Step[] = [
  "scrape",
  "parse",
  "normalize",
  "refdata",
  "geocode",
  "build",
  "all",
];

interface Flags {
  force: boolean;
  minRows: number;
  maxIdChurn: number;
  skipScrape: boolean;
  refdata: RefdataOptions;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    force: false,
    minRows: DEFAULT_MIN_ROWS,
    maxIdChurn: DEFAULT_MAX_ID_CHURN,
    skipScrape: false,
    refdata: {},
  };

  for (const arg of argv) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--skip-scrape") flags.skipScrape = true;
    else if (arg === "--kommuner") flags.refdata.kommuner = true;
    else if (arg === "--alias") flags.refdata.alias = true;
    else if (arg === "--geometri") flags.refdata.geometry = true;
    else if (arg.startsWith("--min-rows=")) {
      const value = Number(arg.slice("--min-rows=".length));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Ugyldig verdi for --min-rows: ${arg}`);
      }
      flags.minRows = value;
    } else if (arg.startsWith("--max-id-churn=")) {
      const value = Number(arg.slice("--max-id-churn=".length));
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Ugyldig verdi for --max-id-churn (0-1): ${arg}`);
      }
      flags.maxIdChurn = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Ukjent flagg: ${arg}`);
    }
  }

  return flags;
}

function usage(): string {
  return [
    "Bruk: pnpm pipeline <steg> [flagg]",
    "",
    "Steg:",
    "  scrape      Hent kildesiden og lagre den til raw/latest.html",
    "  parse       Les raw/latest.html og skriv ut en oppsummering av radene",
    "  normalize   Parse + normaliser, og skriv ut fordelinger",
    "  refdata     Hent referansedata (kommuneliste, aliastabell, kommunegeometri)",
    "  geocode     Kjor geokodingsstigen (adresse -> OSM -> stedsnavn -> sentroide)",
    "  build       Bygg data/quizzes.json med overstyringer og sikkerhetssjekker",
    "  all         scrape -> build -> geocode",
    "",
    "Flagg:",
    "  --force              Overstyr sikkerhetssjekkene (ikke skjemavalidering)",
    "  --min-rows=N         Minste antall quizer for byggingen feiler (standard 250)",
    "  --max-id-churn=0.1   Storste tillatte andel endrede id-er (standard 0.1)",
    "  --skip-scrape        For 'all': bruk eksisterende raw/latest.html",
    "  --kommuner           For 'refdata': hent bare kommunelisten",
    "  --alias              For 'refdata': bygg bare aliastabellen",
    "  --geometri           For 'refdata': hent bare kommunegeometrien",
  ].join("\n");
}

function tally(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

function printTally(label: string, values: string[]): void {
  console.log(`\n${label}:`);
  for (const [key, count] of tally(values)) {
    console.log(`  ${key.padEnd(16)} ${count}`);
  }
}

function printWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  console.log(`\nAdvarsler (${warnings.length}):`);
  for (const warning of warnings.slice(0, 20)) console.log(`  - ${warning}`);
  if (warnings.length > 20) console.log(`  ... og ${warnings.length - 20} til`);
}

async function runScrape(): Promise<void> {
  const result = await scrape();
  console.log(
    `Hentet kildesiden (${result.bytes} bytes) -> raw/latest.html` +
      (result.changed ? " (endret)" : " (uendret)"),
  );
}

async function runParse(): Promise<void> {
  const parsed = await parse();
  console.log(`Sist oppdatert hos kilden: ${parsed.sourceUpdatedAt ?? "ukjent"}`);
  console.log(`Antall rader: ${parsed.rows.length}`);
  printTally(
    "Rader per fylke",
    parsed.rows.map((row) => row.fylke),
  );
  printWarnings(parsed.warnings);
}

async function runNormalize(): Promise<void> {
  const parsed = await parse();
  const normalized = normalizeRows(parsed);
  console.log(`Steder: ${normalized.venues.length}`);
  console.log(`Quizer: ${normalized.quizzes.length}`);
  printTally(
    "Gjentakelse",
    normalized.quizzes.map((quiz) => quiz.recurrence.kind),
  );
  // A quiz can name several genres, so these buckets deliberately overlap and will sum
  // to more than the number of quizzes.
  printTally(
    "Kategori (en quiz kan telle i flere)",
    normalized.quizzes.flatMap((quiz) => quiz.categoryNorm),
  );
  const multiGenre = normalized.quizzes.filter((quiz) => quiz.categoryNorm.length > 1).length;
  console.log(`Quizer med mer enn en sjanger: ${multiGenre}`);
  const withAddress = normalized.venues.filter((venue) => venue.addressHint).length;
  console.log(`\nSteder med adressehint: ${withAddress} av ${normalized.venues.length}`);
  const withoutTime = normalized.quizzes.filter((quiz) => quiz.time === null).length;
  console.log(`Quizer uten klokkeslett: ${withoutTime}`);
  printWarnings(normalized.warnings);
}

async function runGeocodeStep(): Promise<void> {
  const data = JSON.parse(await fs.readFile(PATHS.quizzes, "utf8")) as QuizData;
  const geometry = await loadKommuneGeometry();
  if (!geometry) {
    console.log(
      "Advarsel: data/kommune-geometri.json mangler, sa ingen treff kan verifiseres " +
        "mot kommunen. Kjor 'pnpm pipeline refdata' forst.",
    );
  }

  const venues = data.venues.filter((venue) => !venue.stale);
  const cache = await GeoCache.load();
  const ladder = createProviders({ venues, geometry, log: (line) => console.log(line) });
  const stats = await runGeocode(venues, ladder.providers, cache);

  console.log(
    `\nGeokoding: ${stats.total} steder, ${stats.cached} fra cache, ` +
      `${stats.resolved} nye, ${stats.unresolved} uten treff.`,
  );
  for (const [source, count] of Object.entries(stats.bySource).sort()) {
    console.log(`  ${source.padEnd(12)} ${count}`);
  }

  const withoutKommune = venues.filter((venue) => !venue.kommuneNr);
  if (withoutKommune.length > 0) {
    console.log(`\nSteder uten kommunenummer (${withoutKommune.length}):`);
    for (const venue of withoutKommune) console.log(`  ${venue.id} (${venue.kommune})`);
  }

  reportRejected(ladder);
  reportCollisions(venues, ladder);
  reportConfidence(venues, cache);
}

function reportRejected(ladder: ReturnType<typeof createProviders>): void {
  const rejected = ladder.overpass.rejected;
  console.log(`\nOSM-treff forkastet av kommunesjekken: ${rejected.length}`);
  for (const entry of rejected.slice(0, 25)) {
    console.log(
      `  ${entry.venueName} -> "${entry.candidateName}" (${entry.osm}), ` +
        `${entry.distanceKm} km fra ${entry.kommuneNr}`,
    );
  }
  if (rejected.length > 25) console.log(`  ... og ${rejected.length - 25} til`);
}

function reportCollisions(venues: QuizData["venues"], ladder: ReturnType<typeof createProviders>): void {
  const collisions = crossKommuneCollisions(venues, ladder);
  console.log(
    `\nStedsnavn som ogsa ville truffet i andre kommuner uten kommunesjekken: ` +
      `${collisions.length}`,
  );
  for (const collision of collisions.slice(0, 25)) {
    console.log(
      `  ${collision.venueName} (${collision.kommuneNr}) ville ogsa truffet i ` +
        `${collision.elsewhere.length} andre kommuner: ${collision.elsewhere.join(", ")}`,
    );
  }
  if (collisions.length > 25) console.log(`  ... og ${collisions.length - 25} til`);
}

function reportConfidence(venues: QuizData["venues"], cache: GeoCache): void {
  const counts = new Map<string, number>();
  let placed = 0;
  for (const venue of venues) {
    const entry = cache.get(venue.id);
    if (!entry) continue;
    placed += 1;
    const key = `${entry.geoSource}/${entry.geoConfidence}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log(`\nKoordinater i cachen: ${placed} av ${venues.length} steder`);
  for (const [key, count] of [...counts.entries()].sort()) {
    console.log(`  ${key.padEnd(20)} ${count}`);
  }
}

async function runBuild(flags: Flags): Promise<void> {
  const parsed = await parse();
  const outcome = await build(parsed, {
    force: flags.force,
    minRows: flags.minRows,
    maxIdChurn: flags.maxIdChurn,
  });
  await writeQuizData(outcome.data);

  const { report, data } = outcome;
  console.log(`Skrev data/quizzes.json`);
  console.log(`  Steder: ${report.venueCount} (${report.staleVenues} markert utgatt)`);
  console.log(`  Quizer: ${report.quizCount} (${report.staleQuizzes} markert utgatt)`);
  console.log(`  Nye id-er: ${report.newIds.length}, forsvunnet: ${report.removedIds.length}`);
  console.log(`  Id-endring: ${(report.idChurn * 100).toFixed(1)} %`);
  console.log(`  Sist oppdatert hos kilden: ${data.sourceUpdatedAt ?? "ukjent"}`);
  if (report.railsTripped.length > 0) {
    console.log(`\nSikkerhetssjekker utlost, men overstyrt med --force:`);
    for (const rail of report.railsTripped) console.log(`  - ${rail}`);
  }
  printWarnings(report.warnings);
}

async function main(): Promise<void> {
  const [, , stepArg, ...rest] = process.argv;

  if (!stepArg || stepArg === "--help" || stepArg === "-h") {
    console.log(usage());
    process.exit(stepArg ? 0 : 1);
  }

  if (!STEPS.includes(stepArg as Step)) {
    console.error(`Ukjent steg: ${stepArg}\n`);
    console.error(usage());
    process.exit(1);
  }

  const step = stepArg as Step;
  const flags = parseFlags(rest);

  switch (step) {
    case "scrape":
      await runScrape();
      break;
    case "parse":
      await runParse();
      break;
    case "normalize":
      await runNormalize();
      break;
    case "refdata":
      await runRefdata(flags.refdata);
      break;
    case "geocode":
      await runGeocodeStep();
      break;
    case "build":
      await runBuild(flags);
      break;
    case "all":
      if (!flags.skipScrape) await runScrape();
      await runBuild(flags);
      await runGeocodeStep();
      break;
  }
}

main().catch((error: unknown) => {
  if (error instanceof SafetyRailError) {
    console.error(`\n${error.message}`);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
