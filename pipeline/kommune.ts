import fs from "node:fs/promises";
import { KNOWN_UNRESOLVED, MANUAL_KOMMUNE_ALIASES, KNOWN_FYLKE_MOVES, LEGACY_FYLKE_TO_CURRENT } from "./kommune-manual.js";
import { PATHS } from "./paths.js";
import {
  KommuneAliasFileSchema,
  KommuneGeometryFileSchema,
  KommuneListSchema,
  SVALBARD_NR,
  type Kommune,
  type KommuneAliasEntry,
  type KommuneAliasFile,
  type KommuneGeometry,
  type KommuneGeometryFile,
  type KommuneList,
  type Position,
} from "./schema.js";
import {
  bboxContains,
  distanceToMultiPolygonMeters,
  pointInMultiPolygon,
  type BBox,
} from "./geo/geometry.js";

/**
 * Kommune and fylke normalisation.
 *
 * The source's place column is not a kommune and its fylke column uses pre-2020 names, so
 * neither joins against modern Norwegian geodata. Everything downstream - and in
 * particular the in-kommune check that keeps a fuzzy OSM match from placing a venue in the
 * wrong town - depends on this module resolving the place name first.
 */

/** Mainland Norway, generously. Svalbard falls well outside it and is handled separately. */
export const NORWAY_BBOX: BBox = [4, 57, 32, 72];

/** Svalbard, including Bjørnøya in the south. */
export const SVALBARD_BBOX: BBox = [8, 73.5, 35, 81];

/**
 * How far outside a kommune polygon a point may fall and still count as inside.
 *
 * The committed polygons are simplified to a few hundred metres, and a venue can sit
 * legitimately on a kommune border. A kilometre and a half absorbs both without coming
 * anywhere near letting a wrong-town match through - the false positives this check exists
 * to catch are tens to hundreds of kilometres off.
 */
export const KOMMUNE_TOLERANCE_METERS = 1_500;

/**
 * Folds a Norwegian place name to a comparison key: case, æøå, diacritics, the old `aa`
 * spelling, punctuation and whitespace all disappear. "Greåker", "GREAAKER" and
 * "Gre Aker" all land on the same key.
 */
export function normalizePlaceName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/aa/g, "a")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Official kommune names sometimes carry a Sami or Kven name too ("Sortland - Suortá").
 * Either half should match, so each is indexed separately.
 */
export function kommuneNameVariants(navn: string): string[] {
  const parts = navn.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? [navn, ...parts] : [navn];
}

interface KommuneIndex {
  byExactName: Map<string, Kommune[]>;
  byNormalizedName: Map<string, Kommune[]>;
  byNr: Map<string, Kommune>;
}

export function indexKommuner(list: KommuneList): KommuneIndex {
  const byExactName = new Map<string, Kommune[]>();
  const byNormalizedName = new Map<string, Kommune[]>();
  const byNr = new Map<string, Kommune>();

  for (const kommune of list.kommuner) {
    byNr.set(kommune.nr, kommune);
    for (const variant of kommuneNameVariants(kommune.navn)) {
      push(byExactName, variant, kommune);
      push(byNormalizedName, normalizePlaceName(variant), kommune);
    }
  }

  return { byExactName, byNormalizedName, byNr };
}

function push(map: Map<string, Kommune[]>, key: string, value: Kommune): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.some((k) => k.nr === value.nr)) existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function entryFor(
  kommune: Kommune,
  resolvedBy: KommuneAliasEntry["resolvedBy"],
  note?: string,
): KommuneAliasEntry {
  return {
    kommuneNr: kommune.nr,
    kommuneName: kommune.navn,
    fylkeNr: kommune.fylkeNr,
    fylkeNavn: kommune.fylkeNavn,
    resolvedBy,
    ...(note ? { note } : {}),
  };
}

function unresolvedEntry(note: string): KommuneAliasEntry {
  return {
    kommuneNr: null,
    kommuneName: null,
    fylkeNr: null,
    fylkeNavn: null,
    resolvedBy: "unresolved",
    note,
  };
}

export class AliasTableError extends Error {}

/**
 * Resolves one source place name.
 *
 * The manual table wins over automatic matching, because the cases it covers are exactly
 * the ones where an automatic match would be confidently wrong.
 */
export function resolvePlaceName(placeName: string, index: KommuneIndex): KommuneAliasEntry {
  const manualTarget = MANUAL_KOMMUNE_ALIASES[placeName];
  if (manualTarget) {
    const kommune =
      index.byExactName.get(manualTarget)?.[0] ??
      index.byNormalizedName.get(normalizePlaceName(manualTarget))?.[0];
    if (!kommune) {
      throw new AliasTableError(
        `Aliastabellen peker "${placeName}" til "${manualTarget}", som ikke finnes i ` +
          `data/kommuner.json. Rett opp pipeline/kommune-manual.ts.`,
      );
    }
    return entryFor(kommune, "manual", `Kilden skriver "${placeName}".`);
  }

  const known = KNOWN_UNRESOLVED[placeName];
  if (known) return unresolvedEntry(known);

  const exact = index.byExactName.get(placeName);
  if (exact?.length === 1 && exact[0]) return entryFor(exact[0], "exact");
  if (exact && exact.length > 1) {
    return unresolvedEntry(
      `Flertydig: "${placeName}" er navnet pa ${exact.length} kommuner ` +
        `(${exact.map((k) => `${k.navn} ${k.nr}`).join(", ")}). Ma settes i pipeline/kommune-manual.ts.`,
    );
  }

  const normalized = index.byNormalizedName.get(normalizePlaceName(placeName));
  if (normalized?.length === 1 && normalized[0]) return entryFor(normalized[0], "normalized");
  if (normalized && normalized.length > 1) {
    return unresolvedEntry(
      `Flertydig etter normalisering: "${placeName}" treffer ${normalized.length} kommuner ` +
        `(${normalized.map((k) => `${k.navn} ${k.nr}`).join(", ")}).`,
    );
  }

  return unresolvedEntry(
    `Fant ingen kommune som matcher "${placeName}". Legg inn en mapping i pipeline/kommune-manual.ts.`,
  );
}

export function buildAliasTable(
  placeNames: Iterable<string>,
  list: KommuneList,
  now: Date = new Date(),
): KommuneAliasFile {
  const index = indexKommuner(list);
  const aliases: Record<string, KommuneAliasEntry> = {};
  for (const placeName of [...new Set(placeNames)].sort((a, b) => (a < b ? -1 : 1))) {
    aliases[placeName] = resolvePlaceName(placeName, index);
  }
  return { generatedAt: now.toISOString(), aliases };
}

/* ------------------------------ fylke cross-check ---------------------------------- */

export interface FylkeMismatch {
  placeName: string;
  sourceFylke: string;
  expected: string;
  actual: string;
}

/**
 * Cross-checks the alias table against the source's pre-2020 fylke names.
 *
 * `fylkeNow` is always derived from the resolved kommune, which is authoritative. This is
 * purely a smoke test of the manual mappings: if "Greåker" resolved to a kommune in
 * Trøndelag while the source says Østfold, the mapping is wrong.
 */
export function checkFylkeConsistency(
  places: Array<{ kommune: string; fylke: string }>,
  alias: KommuneAliasFile,
): FylkeMismatch[] {
  const mismatches: FylkeMismatch[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    if (seen.has(place.kommune)) continue;
    seen.add(place.kommune);
    if (KNOWN_FYLKE_MOVES[place.kommune]) continue;

    const entry = alias.aliases[place.kommune];
    if (!entry?.fylkeNavn) continue;

    const expected = LEGACY_FYLKE_TO_CURRENT[place.fylke];
    if (!expected) continue;
    if (expected !== entry.fylkeNavn) {
      mismatches.push({
        placeName: place.kommune,
        sourceFylke: place.fylke,
        expected,
        actual: entry.fylkeNavn,
      });
    }
  }

  return mismatches;
}

/* ---------------------------------- loading ---------------------------------------- */

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error(`Kunne ikke lese ${file}: ugyldig JSON.`);
    throw error;
  }
}

export async function loadKommuneList(file: string = PATHS.kommuner): Promise<KommuneList | null> {
  const raw = await readJson(file);
  return raw === null ? null : KommuneListSchema.parse(raw);
}

export async function loadAliasTable(
  file: string = PATHS.kommuneAlias,
): Promise<KommuneAliasFile | null> {
  const raw = await readJson(file);
  return raw === null ? null : KommuneAliasFileSchema.parse(raw);
}

export async function loadKommuneGeometry(
  file: string = PATHS.kommuneGeometry,
): Promise<KommuneGeometryFile | null> {
  const raw = await readJson(file);
  return raw === null ? null : KommuneGeometryFileSchema.parse(raw);
}

/* -------------------------------- verification ------------------------------------- */

/**
 * True when the point is somewhere in Norway, Svalbard included.
 *
 * A wrong coordinate renders as a confident pin that a user cannot tell is wrong, so this
 * is the coarse first gate: anything a provider returns from outside the country is a
 * mismatch, not a near miss.
 */
export function isInNorway(lat: number, lon: number): boolean {
  const point: Position = [lon, lat];
  return bboxContains(NORWAY_BBOX, point) || bboxContains(SVALBARD_BBOX, point);
}

export type KommuneCheck = "inside" | "outside" | "unknown";

/**
 * Verifies that a coordinate falls inside the kommune it is supposed to be in.
 *
 * This is the load-bearing check. Seven venue names in the dataset recur across different
 * kommuner - chains like O'Learys and generic names like Samfundet - and a fuzzy match on
 * the wrong town's Samfundet looks perfectly correct in the UI while sending someone to a
 * different city. Returns "unknown" when we have no geometry, so the caller can decide
 * rather than silently accepting.
 */
export function checkInKommune(
  lat: number,
  lon: number,
  kommuneNr: string,
  geometry: KommuneGeometryFile | null,
  toleranceMeters: number = KOMMUNE_TOLERANCE_METERS,
): KommuneCheck {
  const point: Position = [lon, lat];

  if (kommuneNr === SVALBARD_NR) {
    return bboxContains(SVALBARD_BBOX, point) ? "inside" : "outside";
  }

  const kommune: KommuneGeometry | undefined = geometry?.kommuner[kommuneNr];
  if (!kommune) return "unknown";

  // The bbox is a cheap reject for the overwhelming majority of wrong matches. The padding
  // matches the tolerance so a point just outside the bbox still gets the exact test.
  const padding = toleranceMeters / 111_320;
  if (!bboxContains(kommune.bbox, point, padding)) return "outside";

  if (pointInMultiPolygon(point, kommune.polygons)) return "inside";
  return distanceToMultiPolygonMeters(point, kommune.polygons) <= toleranceMeters
    ? "inside"
    : "outside";
}
