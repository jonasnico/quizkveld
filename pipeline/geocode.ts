import fs from "node:fs/promises";
import path from "node:path";
import { CentroidProvider } from "./geo/centroid.js";
import { AddressProvider, PlaceNameProvider } from "./geo/kartverket.js";
import { OverpassProvider } from "./geo/overpass.js";
import { PATHS } from "./paths.js";
import {
  GeoCacheSchema,
  type GeoCacheData,
  type GeoCacheEntry,
  type GeoConfidence,
  type GeoSource,
  type KommuneGeometryFile,
  type Venue,
} from "./schema.js";

/**
 * Geocoding.
 *
 * The cache layer and the ladder driver below are unchanged from phase 1; the four
 * provider implementations now live in `pipeline/geo/`. Because the cache is keyed by the
 * stable venue id and the driver persists after every hit, the whole of
 * `data/geocache.json` can be deleted and rebuilt from scratch with no manual work. A
 * coordinate that genuinely has to be hand-placed belongs in `data/overrides.json` with
 * `geoSource: "manual"`, not in here.
 */

export interface GeoResult {
  lat: number;
  lon: number;
  geoSource: GeoSource;
  geoConfidence: GeoConfidence;
}

export interface GeoProvider {
  readonly name: GeoSource;
  /** Returns coordinates for the venue, or null when this provider cannot resolve it. */
  lookup(venue: Venue): Promise<GeoResult | null>;
}

/**
 * Append-only cache keyed by venue id. Entries are never deleted by the pipeline: a venue
 * that disappears upstream and comes back later should keep its coordinates.
 */
export class GeoCache {
  private data: GeoCacheData = {};

  private constructor(private readonly file: string) {}

  static async load(file: string = PATHS.geocache): Promise<GeoCache> {
    const cache = new GeoCache(file);
    try {
      const text = await fs.readFile(file, "utf8");
      cache.data = GeoCacheSchema.parse(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof SyntaxError) {
          throw new Error(`Kunne ikke lese ${file}: ugyldig JSON.`);
        }
        throw error;
      }
      cache.data = {};
    }
    return cache;
  }

  get(venueId: string): GeoCacheEntry | undefined {
    return this.data[venueId];
  }

  has(venueId: string): boolean {
    return venueId in this.data;
  }

  set(venueId: string, result: GeoResult, resolvedAt: Date = new Date()): void {
    this.data[venueId] = {
      lat: result.lat,
      lon: result.lon,
      geoSource: result.geoSource,
      geoConfidence: result.geoConfidence,
      resolvedAt: resolvedAt.toISOString(),
    };
  }

  get size(): number {
    return Object.keys(this.data).length;
  }

  /** Returns the cache contents with keys sorted, so the committed file diffs cleanly. */
  toJSON(): GeoCacheData {
    const sorted: GeoCacheData = {};
    for (const key of Object.keys(this.data).sort()) {
      const entry = this.data[key];
      if (entry) sorted[key] = entry;
    }
    return sorted;
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(this.toJSON(), null, 2)}\n`, "utf8");
  }
}

/**
 * Builds the real geocoding ladder.
 *
 * Order is address -> osm -> kartverket -> centroid. Overpass is the workhorse - only 3 of
 * 322 venues carry an address - but the address rung is cheap to keep first because it
 * only fires for venues that actually have one, and when it does it produces a better
 * coordinate than any name match can.
 */
export function createProviders(options: LadderOptions): GeoLadder {
  const venuesPerKommune = new Map<string, number>();
  for (const venue of options.venues) {
    if (!venue.kommuneNr) continue;
    venuesPerKommune.set(venue.kommuneNr, (venuesPerKommune.get(venue.kommuneNr) ?? 0) + 1);
  }

  const shared = { geometry: options.geometry, log: options.log };
  const address = new AddressProvider(shared);
  const overpass = new OverpassProvider(shared);
  const placeName = new PlaceNameProvider(shared);
  const centroid = new CentroidProvider({ ...shared, venuesPerKommune });

  return {
    providers: [address, overpass, placeName, centroid],
    address,
    overpass,
    placeName,
    centroid,
  };
}

export interface LadderOptions {
  venues: Venue[];
  geometry: KommuneGeometryFile | null;
  log?: (message: string) => void;
}

export interface GeoLadder {
  providers: GeoProvider[];
  address: AddressProvider;
  overpass: OverpassProvider;
  placeName: PlaceNameProvider;
  centroid: CentroidProvider;
}

/**
 * Counts, for every venue, how many venues in *other* kommuner Overpass would have
 * matched by name alone.
 *
 * This is the measurement of what the kommune constraint is actually worth. Seven venue
 * names in the dataset recur across kommuner, and without the constraint a name search
 * would have to guess between them. Running it over the pools already in memory costs
 * nothing extra.
 */
export function crossKommuneCollisions(
  venues: Venue[],
  ladder: GeoLadder,
): Array<{ venueId: string; venueName: string; kommuneNr: string; elsewhere: string[] }> {
  const collisions: Array<{
    venueId: string;
    venueName: string;
    kommuneNr: string;
    elsewhere: string[];
  }> = [];

  for (const venue of venues) {
    if (!venue.kommuneNr) continue;
    const elsewhere: string[] = [];
    for (const [kommuneNr, pool] of ladder.overpass.pools) {
      if (kommuneNr === venue.kommuneNr) continue;
      const hit = ladder.overpass.matchAgainstPool(venue, kommuneNr, pool, false);
      if (hit) elsewhere.push(kommuneNr);
    }
    if (elsewhere.length > 0) {
      collisions.push({
        venueId: venue.id,
        venueName: venue.name,
        kommuneNr: venue.kommuneNr,
        elsewhere,
      });
    }
  }

  return collisions;
}

/** Kept for tests and for callers that only want the shape of the ladder. */
export function defaultProviders(): GeoProvider[] {
  return createProviders({ venues: [], geometry: null }).providers;
}

export interface GeocodeStats {
  total: number;
  cached: number;
  resolved: number;
  unresolved: number;
  bySource: Record<string, number>;
}

/**
 * Walks the provider ladder for every venue that is not already cached, persisting after
 * each hit so an interrupted run never loses work.
 */
export async function runGeocode(
  venues: Venue[],
  providers: GeoProvider[] = defaultProviders(),
  cache?: GeoCache,
): Promise<GeocodeStats> {
  const geoCache = cache ?? (await GeoCache.load());
  const stats: GeocodeStats = {
    total: venues.length,
    cached: 0,
    resolved: 0,
    unresolved: 0,
    bySource: {},
  };

  for (const venue of venues) {
    if (geoCache.has(venue.id)) {
      stats.cached += 1;
      continue;
    }

    let hit: GeoResult | null = null;
    for (const provider of providers) {
      hit = await provider.lookup(venue);
      if (hit) break;
    }

    if (hit) {
      geoCache.set(venue.id, hit);
      await geoCache.save();
      stats.resolved += 1;
      stats.bySource[hit.geoSource] = (stats.bySource[hit.geoSource] ?? 0) + 1;
    } else {
      stats.unresolved += 1;
    }
  }

  await geoCache.save();
  return stats;
}
