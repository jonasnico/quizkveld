import fs from "node:fs/promises";
import path from "node:path";
import { PATHS } from "./paths.js";
import {
  GeoCacheSchema,
  type GeoCacheData,
  type GeoCacheEntry,
  type GeoConfidence,
  type GeoSource,
  type Venue,
} from "./schema.js";

/**
 * Geocoding.
 *
 * PHASE 1 SCOPE: the cache layer and the provider ladder below are real and working; the
 * four provider implementations are deliberate stubs. A later session fills them in with
 * the actual lookups (Kartverket Adresse -> Overpass/OSM -> Kartverket Stedsnavn ->
 * kommune centroid). Because the ladder already runs end-to-end and the cache is keyed by
 * the stable venue id, that session only has to implement `lookup`.
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

function stub(name: GeoSource): GeoProvider {
  return {
    name,
    async lookup(): Promise<GeoResult | null> {
      // TODO(phase-2): implement the real lookup for this rung of the ladder.
      return null;
    },
  };
}

/**
 * The geocoding ladder, in the order it should be attempted. Each rung is more
 * approximate than the one before it.
 *
 * TODO(phase-2):
 *  - address:    Kartverket Adresse API, using `venue.addressHint` + `venue.kommune`.
 *  - osm:        Overpass, searching for the venue name near the kommune.
 *  - kartverket: Kartverket Stedsnavn, for named places rather than addresses.
 *  - centroid:   kommune centroid as a last resort (geoConfidence "low").
 */
export function defaultProviders(): GeoProvider[] {
  return [stub("address"), stub("osm"), stub("kartverket"), stub("centroid")];
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
