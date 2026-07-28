import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved relative to this file so the CLI works from any cwd. */
export const ROOT = path.resolve(here, "..");

export const PATHS = {
  root: ROOT,
  rawDir: path.join(ROOT, "raw"),
  rawHtml: path.join(ROOT, "raw", "latest.html"),
  dataDir: path.join(ROOT, "data"),
  quizzes: path.join(ROOT, "data", "quizzes.json"),
  overrides: path.join(ROOT, "data", "overrides.json"),
  geocache: path.join(ROOT, "data", "geocache.json"),
  kommuner: path.join(ROOT, "data", "kommuner.json"),
  kommuneAlias: path.join(ROOT, "data", "kommune-alias.json"),
  kommuneGeometry: path.join(ROOT, "data", "kommune-geometri.json"),
} as const;

export const SOURCE_URL =
  "https://www.norgesquizforbund.no/arrangementer/finn-din-pubquiz/";

export const USER_AGENT =
  "quizkveld/1.0 (+https://github.com/jonasnico/quizkveld; kontakt via GitHub issues)";

/** Keyless public APIs used by the reference-data and geocoding steps. */
export const API = {
  kommuneinfo: "https://ws.geonorge.no/kommuneinfo/v1",
  adresse: "https://ws.geonorge.no/adresser/v1",
  stedsnavn: "https://ws.geonorge.no/stedsnavn/v1",
  /**
   * Overpass mirrors, tried in order. All are volunteer-run, so the geocoding step
   * throttles hard and backs off on 429/504.
   */
  overpass: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ],
} as const;
