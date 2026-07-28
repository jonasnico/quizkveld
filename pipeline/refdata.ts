import fs from "node:fs/promises";
import path from "node:path";
import { buildAliasTable, checkFylkeConsistency, loadAliasTable, loadKommuneList } from "./kommune.js";
import { fetchJson } from "./geo/http.js";
import { bboxOf, roundRing, simplifyRing } from "./geo/geometry.js";
import { normalizeRows } from "./normalize.js";
import { parse } from "./parse.js";
import { API, PATHS } from "./paths.js";
import {
  KommuneGeometryFileSchema,
  KommuneListSchema,
  SVALBARD_NR,
  type Kommune,
  type KommuneAliasFile,
  type KommuneGeometry,
  type KommuneGeometryFile,
  type KommuneList,
  type Position,
} from "./schema.js";

/**
 * Reference-data fetchers.
 *
 * Run by hand with `pnpm pipeline refdata`, never by the daily job. The three files these
 * produce are stable geography: an official kommune list, the alias table that maps the
 * source's place names onto it, and simplified kommune outlines. Committing them means a
 * normal pipeline run needs no network beyond the source page itself, and that a Geonorge
 * outage cannot affect the daily build.
 */

/** Douglas-Peucker tolerance for the committed kommune outlines. */
export const SIMPLIFY_TOLERANCE_METERS = 200;

/**
 * Svalbard is not a kommune, has no kommunenummer in Kartverket's register and no polygon
 * to fetch, but the source lists Longyearbyen. A synthetic entry keeps it in the same
 * shape as everything else; the in-kommune check special-cases it with a bounding box.
 */
const SVALBARD: Kommune = {
  nr: SVALBARD_NR,
  navn: "Svalbard",
  fylkeNr: "21",
  fylkeNavn: "Svalbard",
};

interface GeonorgeFylke {
  fylkesnavn: string;
  fylkesnummer: string;
}

interface GeonorgeFylkeDetail extends GeonorgeFylke {
  kommuner: Array<{ kommunenavn: string; kommunenummer: string }>;
}

interface GeonorgeKommuneDetail {
  kommunenavn: string;
  kommunenummer: string;
  punktIOmrade?: { coordinates: [number, number] };
}

interface GeonorgeOmrade {
  omrade: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Fetches the official kommune list. Kartverket exposes kommune-to-fylke only per fylke,
 * so this walks the 15 fylker rather than the 357 kommuner.
 */
export async function fetchKommuneList(now: Date = new Date()): Promise<KommuneList> {
  const fylker = await fetchJson<GeonorgeFylke[]>(`${API.kommuneinfo}/fylker`);
  const kommuner: Kommune[] = [];

  for (const fylke of fylker) {
    const detail = await fetchJson<GeonorgeFylkeDetail>(
      `${API.kommuneinfo}/fylker/${fylke.fylkesnummer}?filtrer=fylkesnavn,fylkesnummer,kommuner`,
    );
    for (const kommune of detail.kommuner) {
      kommuner.push({
        nr: kommune.kommunenummer,
        navn: kommune.kommunenavn,
        fylkeNr: fylke.fylkesnummer,
        fylkeNavn: fylke.fylkesnavn,
      });
    }
  }

  kommuner.push(SVALBARD);
  kommuner.sort((a, b) => (a.nr < b.nr ? -1 : 1));

  return KommuneListSchema.parse({
    fetchedAt: now.toISOString(),
    source: `${API.kommuneinfo}/fylker`,
    fylker: [
      ...fylker
        .map((f) => ({ nr: f.fylkesnummer, navn: f.fylkesnavn }))
        .sort((a, b) => (a.nr < b.nr ? -1 : 1)),
      { nr: SVALBARD.fylkeNr, navn: SVALBARD.fylkeNavn },
    ].sort((a, b) => (a.nr < b.nr ? -1 : 1)),
    kommuner,
  });
}

/** Reads the source's place names straight from the scraped page, not the built output. */
export async function sourcePlaces(): Promise<Array<{ kommune: string; fylke: string }>> {
  const normalized = normalizeRows(await parse());
  return normalized.venues.map((venue) => ({ kommune: venue.kommune, fylke: venue.fylke }));
}

function toMultiPolygon(omrade: GeonorgeOmrade["omrade"]): Position[][][] {
  const raw =
    omrade.type === "Polygon"
      ? [omrade.coordinates as number[][][]]
      : (omrade.coordinates as number[][][][]);
  return raw.map((polygon) =>
    polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as Position)),
  );
}

export async function fetchKommuneGeometry(
  kommuneNumbers: string[],
  list: KommuneList,
  now: Date = new Date(),
): Promise<KommuneGeometryFile> {
  const byNr = new Map(list.kommuner.map((k) => [k.nr, k]));
  const kommuner: Record<string, KommuneGeometry> = {};

  for (const nr of [...new Set(kommuneNumbers)].sort()) {
    // Svalbard has no polygon in Kartverket's register; the bounding box in kommune.ts
    // stands in for it.
    if (nr === SVALBARD_NR) continue;

    const detail = await fetchJson<GeonorgeKommuneDetail>(
      `${API.kommuneinfo}/kommuner/${nr}?filtrer=kommunenavn,kommunenummer,punktIOmrade`,
    );
    const area = await fetchJson<GeonorgeOmrade>(
      `${API.kommuneinfo}/kommuner/${nr}/omrade?utkoordsys=4258`,
    );

    const polygons = toMultiPolygon(area.omrade).map((polygon) =>
      polygon.map((ring) => roundRing(simplifyRing(ring, SIMPLIFY_TOLERANCE_METERS))),
    );

    const center = detail.punktIOmrade?.coordinates;
    if (!center) {
      throw new Error(`Kommune ${nr} mangler punktIOmrade hos Kartverket.`);
    }

    kommuner[nr] = {
      navn: byNr.get(nr)?.navn ?? detail.kommunenavn,
      bbox: bboxOf(polygons),
      center: [center[0], center[1]],
      polygons,
    };
    console.log(
      `  ${nr} ${kommuner[nr].navn}: ${polygons.length} polygon(er), ` +
        `${polygons.flat().flat().length} punkter etter forenkling`,
    );
  }

  return KommuneGeometryFileSchema.parse({
    fetchedAt: now.toISOString(),
    source: `${API.kommuneinfo}/kommuner/{nr}/omrade`,
    simplifyToleranceMeters: SIMPLIFY_TOLERANCE_METERS,
    kommuner,
  });
}

export interface RefdataOptions {
  kommuner?: boolean;
  alias?: boolean;
  geometry?: boolean;
  now?: Date;
}

export async function runRefdata(options: RefdataOptions = {}): Promise<void> {
  const now = options.now ?? new Date();
  const all = !options.kommuner && !options.alias && !options.geometry;

  if (all || options.kommuner) {
    console.log("Henter offisiell kommuneliste fra Kartverket ...");
    const list = await fetchKommuneList(now);
    await writeJson(PATHS.kommuner, list);
    console.log(
      `Skrev data/kommuner.json: ${list.kommuner.length} kommuner, ${list.fylker.length} fylker.`,
    );
  }

  const list = await loadKommuneList();
  if (!list) throw new Error("data/kommuner.json mangler. Kjor 'pnpm pipeline refdata' forst.");

  let alias: KommuneAliasFile | null = null;
  if (all || options.alias) {
    console.log("\nBygger aliastabell for kildens stedsnavn ...");
    const places = await sourcePlaces();
    alias = buildAliasTable(
      places.map((place) => place.kommune),
      list,
      now,
    );
    await writeJson(PATHS.kommuneAlias, alias);
    reportAlias(alias);

    const mismatches = checkFylkeConsistency(places, alias);
    if (mismatches.length > 0) {
      console.log(`\nAdvarsel - fylket stemmer ikke med kilden (${mismatches.length}):`);
      for (const mismatch of mismatches) {
        console.log(
          `  ${mismatch.placeName}: kilden sier ${mismatch.sourceFylke} ` +
            `(altsa ${mismatch.expected}), men kommunen ligger i ${mismatch.actual}.`,
        );
      }
    } else {
      console.log("\nFylkekryssjekk: ingen avvik.");
    }
  } else {
    alias = await loadAliasTable();
  }

  if (all || options.geometry) {
    if (!alias) {
      throw new Error("data/kommune-alias.json mangler. Kjor 'pnpm pipeline refdata --alias'.");
    }
    const numbers = [
      ...new Set(
        Object.values(alias.aliases)
          .map((entry) => entry.kommuneNr)
          .filter((nr): nr is string => nr !== null),
      ),
    ];
    console.log(`\nHenter geometri for ${numbers.length} kommuner (dette tar noen minutter) ...`);
    const geometry = await fetchKommuneGeometry(numbers, list, now);
    await writeJson(PATHS.kommuneGeometry, geometry);
    console.log(
      `Skrev data/kommune-geometri.json: ${Object.keys(geometry.kommuner).length} kommuner.`,
    );
  }
}

export function reportAlias(alias: KommuneAliasFile): void {
  const entries = Object.entries(alias.aliases);
  const counts = new Map<string, number>();
  for (const [, entry] of entries) {
    counts.set(entry.resolvedBy, (counts.get(entry.resolvedBy) ?? 0) + 1);
  }

  console.log(`Skrev data/kommune-alias.json: ${entries.length} stedsnavn.`);
  for (const [kind, count] of [...counts.entries()].sort()) {
    console.log(`  ${kind.padEnd(12)} ${count}`);
  }

  const manual = entries.filter(([, entry]) => entry.resolvedBy === "manual");
  if (manual.length > 0) {
    console.log(`\nMattet mappes for hand (${manual.length}):`);
    for (const [name, entry] of manual) {
      console.log(`  ${name.padEnd(18)} -> ${entry.kommuneName} (${entry.kommuneNr})`);
    }
  }

  const unresolved = entries.filter(([, entry]) => entry.resolvedBy === "unresolved");
  if (unresolved.length > 0) {
    console.log(`\nIkke lost (${unresolved.length}):`);
    for (const [name, entry] of unresolved) console.log(`  ${name}: ${entry.note}`);
  }
}
