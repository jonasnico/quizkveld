import type { GeoProvider, GeoResult } from "../geocode.js";
import type { KommuneGeometryFile, Venue } from "../schema.js";

/**
 * Kommune centroid - the last rung, and a deliberately limited one.
 *
 * A centroid is not where the venue is, it is where the kommune is. In a kommune with one
 * or two quiz venues that is a useful approximation. In Oslo it would stack more than a
 * hundred venues on a single identical point, which looks like a rendering bug on a map
 * and is actively misleading for distance sorting. So the fallback only fires where it
 * still means something, and everywhere else the venue is honestly left without a
 * coordinate.
 */

export const MAX_VENUES_FOR_CENTROID = 3;

export interface CentroidOptions {
  geometry: KommuneGeometryFile | null;
  /** Venue count per kommunenummer across the whole dataset. */
  venuesPerKommune: Map<string, number>;
  maxVenues?: number;
  log?: (message: string) => void;
}

export class CentroidProvider implements GeoProvider {
  readonly name = "centroid" as const;

  /** Venues skipped because their kommune has too many venues to share one point. */
  readonly skipped: string[] = [];

  constructor(private readonly options: CentroidOptions) {}

  async lookup(venue: Venue): Promise<GeoResult | null> {
    if (!venue.kommuneNr) return null;

    const limit = this.options.maxVenues ?? MAX_VENUES_FOR_CENTROID;
    const count = this.options.venuesPerKommune.get(venue.kommuneNr) ?? 0;
    if (count > limit) {
      this.skipped.push(venue.id);
      return null;
    }

    const kommune = this.options.geometry?.kommuner[venue.kommuneNr];
    if (!kommune) return null;

    const [lon, lat] = kommune.center;
    return { lat, lon, geoSource: "centroid", geoConfidence: "low" };
  }
}
