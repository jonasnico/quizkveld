import { checkInKommune } from "../kommune.js";
import { API } from "../paths.js";
import { politeFetch } from "./http.js";
import { haversineMeters } from "./geometry.js";
import {
  pickBest,
  scoreName,
  type Candidate,
  type MatchScore,
  type ScoredCandidate,
} from "./match.js";
import type { GeoProvider, GeoResult } from "../geocode.js";
import type { KommuneGeometryFile, Venue } from "../schema.js";

/**
 * OpenStreetMap via Overpass - the primary source.
 *
 * Only 3 of 322 venues carry an address, so name matching against OSM does the heavy
 * lifting. Two things keep that safe:
 *
 *  - queries are scoped to one kommune's bounding box, so a nationwide name collision
 *    never even enters the candidate pool, and
 *  - every candidate is then tested against the kommune's actual polygon, which catches
 *    the neighbours that a rectangular bbox inevitably drags in.
 *
 * Overpass is volunteer-run, so this issues one query per kommune rather than one per
 * venue, throttles to a request per second, and backs off on 429/504. The full pass runs
 * once; after that data/geocache.json serves everything.
 */

const OVERPASS_TIMEOUT_SECONDS = 180;

/** Tag values that describe somewhere a quiz could plausibly be held. */
const AMENITIES = [
  "pub",
  "bar",
  "cafe",
  "restaurant",
  "nightclub",
  "biergarten",
  "fast_food",
  "community_centre",
  "social_facility",
  "events_venue",
  "theatre",
  "casino",
];

const LEISURES = ["sports_centre", "social_club", "bowling_alley", "adult_gaming_centre"];

export function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const box = `${minLat},${minLon},${maxLat},${maxLon}`;
  const amenity = AMENITIES.join("|");
  const leisure = LEISURES.join("|");
  return [
    `[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];`,
    "(",
    `  nwr["name"]["amenity"~"^(${amenity})$"](${box});`,
    `  nwr["name"]["leisure"~"^(${leisure})$"](${box});`,
    `  nwr["name"]["club"](${box});`,
    `  nwr["name"]["tourism"~"^(hotel|guest_house|hostel)$"](${box});`,
    ");",
    "out center tags;",
  ].join("\n");
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OsmCandidate extends Candidate {
  osm: string;
}

/** Every tag OSM might carry the venue's name under, alt_name lists included. */
export function candidateNames(tags: Record<string, string>): string[] {
  const keys = [
    "name",
    "name:no",
    "name:nb",
    "alt_name",
    "old_name",
    "official_name",
    "short_name",
    "operator",
    "brand",
  ];
  const names = new Set<string>();
  for (const key of keys) {
    const value = tags[key];
    if (!value) continue;
    for (const part of value.split(";")) {
      const trimmed = part.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return [...names];
}

export function elementsToCandidates(elements: OverpassElement[]): OsmCandidate[] {
  const candidates: OsmCandidate[] = [];
  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const tags = element.tags ?? {};
    for (const name of candidateNames(tags)) {
      candidates.push({
        name,
        lat,
        lon,
        osm: `${element.type}/${element.id}`,
        detail: tags.amenity ?? tags.leisure ?? tags.tourism ?? tags.club,
      });
    }
  }
  return candidates;
}

/** A candidate whose name matched but whose position did not. */
export interface RejectedCandidate {
  venueId: string;
  venueName: string;
  kommuneNr: string;
  candidateName: string;
  osm: string;
  lat: number;
  lon: number;
  reason: "utenfor-kommunen" | "utenfor-norge";
  distanceKm: number;
}

export interface OverpassOptions {
  geometry: KommuneGeometryFile | null;
  /** Injected in tests so nothing hits the network. */
  fetchPool?: (kommuneNr: string, bbox: [number, number, number, number]) => Promise<OsmCandidate[]>;
  log?: (message: string) => void;
}

export class OverpassProvider implements GeoProvider {
  readonly name = "osm" as const;

  /** Candidates per kommunenummer, fetched once and reused for every venue there. */
  readonly pools = new Map<string, OsmCandidate[]>();
  readonly rejected: RejectedCandidate[] = [];

  constructor(private readonly options: OverpassOptions) {}

  private log(message: string): void {
    this.options.log?.(message);
  }

  async poolFor(kommuneNr: string): Promise<OsmCandidate[]> {
    const cached = this.pools.get(kommuneNr);
    if (cached) return cached;

    const kommune = this.options.geometry?.kommuner[kommuneNr];
    if (!kommune) {
      this.pools.set(kommuneNr, []);
      return [];
    }

    const fetchPool = this.options.fetchPool ?? fetchOverpassPool;
    let pool: OsmCandidate[] = [];
    try {
      pool = await fetchPool(kommuneNr, kommune.bbox);
      this.log(`  Overpass ${kommuneNr} ${kommune.navn}: ${pool.length} navnekandidater`);
    } catch (error) {
      // An Overpass outage must not take the whole run down; the venues in this kommune
      // simply fall through to the next rung of the ladder.
      this.log(
        `  Overpass ${kommuneNr} ${kommune.navn} feilet: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.pools.set(kommuneNr, pool);
    return pool;
  }

  async lookup(venue: Venue): Promise<GeoResult | null> {
    if (!venue.kommuneNr) return null;
    const pool = await this.poolFor(venue.kommuneNr);
    if (pool.length === 0) return null;
    return this.matchAgainstPool(venue, venue.kommuneNr, pool, true);
  }

  /**
   * Scores a venue against a pool of candidates and enforces the kommune check.
   *
   * `record` is off when this is used as a diagnostic against a kommune the venue does not
   * belong to, so the report only counts real rejections.
   */
  matchAgainstPool(
    venue: Venue,
    kommuneNr: string,
    pool: OsmCandidate[],
    record: boolean,
  ): GeoResult | null {
    const scored: Array<ScoredCandidate<OsmCandidate>> = [];

    for (const candidate of pool) {
      const match: MatchScore | null = scoreName(venue.name, candidate.name);
      if (!match) continue;

      const check = checkInKommune(
        candidate.lat,
        candidate.lon,
        kommuneNr,
        this.options.geometry,
      );
      if (check === "inside") {
        scored.push({ candidate, match });
        continue;
      }

      if (record) {
        const center = this.options.geometry?.kommuner[kommuneNr]?.center;
        this.rejected.push({
          venueId: venue.id,
          venueName: venue.name,
          kommuneNr,
          candidateName: candidate.name,
          osm: candidate.osm,
          lat: candidate.lat,
          lon: candidate.lon,
          reason: "utenfor-kommunen",
          distanceKm: center
            ? Math.round(haversineMeters(center, [candidate.lon, candidate.lat]) / 100) / 10
            : 0,
        });
      }
    }

    const best = pickBest(scored, {
      distanceMeters: (a, b) => haversineMeters([a.lon, a.lat], [b.lon, b.lat]),
    });
    if (!best) return null;

    return {
      lat: best.candidate.lat,
      lon: best.candidate.lon,
      geoSource: "osm",
      geoConfidence: best.match.kind === "exact" ? "high" : "medium",
    };
  }
}

async function fetchOverpassPool(
  _kommuneNr: string,
  bbox: [number, number, number, number],
): Promise<OsmCandidate[]> {
  const query = buildOverpassQuery(bbox);
  let lastError: unknown;

  for (const endpoint of API.overpass) {
    try {
      const response = await politeFetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        // Overpass asks for real gaps between queries from the same client.
        minIntervalMs: 2_000,
        timeoutMs: (OVERPASS_TIMEOUT_SECONDS + 30) * 1_000,
      });
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return elementsToCandidates(payload.elements ?? []);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Overpass svarte ikke");
}
