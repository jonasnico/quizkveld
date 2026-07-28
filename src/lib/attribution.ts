import type { GeoSource, Venue } from "../../pipeline/schema.js";

/**
 * Credits for the data sets the site is built on.
 *
 * Two of the geocoding sources carry licence terms that require attribution in the
 * published product: OpenStreetMap is ODbL, Kartverket/Geonorge is NLOD. This is the same
 * stance the site already takes toward Norges Quizforbund - we build on other people's
 * work and we say whose - except here it is also a licence obligation rather than only
 * good manners.
 *
 * Credits are *derived* from what the data actually contains, never hardcoded into the
 * layout. If no venue carries a coordinate from OpenStreetMap, we do not credit
 * OpenStreetMap. Claiming to use a source we do not use is the same kind of overstatement
 * as claiming a quiz happens on a night the source never promised.
 */

export interface DataCredit {
  /** Stable key, so several geo sources can collapse into one credit line. */
  id: string;
  /** The wording the licence asks for. */
  label: string;
  url: string;
  /** Which licence obliges the credit, shown after the link. */
  licence: string;
}

const OPENSTREETMAP: DataCredit = {
  id: "osm",
  label: "© OpenStreetMap-bidragsytere",
  url: "https://www.openstreetmap.org/copyright",
  licence: "ODbL",
};

const KARTVERKET: DataCredit = {
  id: "kartverket",
  label: "Kartverket / Geonorge",
  url: "https://www.geonorge.no/",
  licence: "NLOD",
};

/**
 * Which credit each `geoSource` triggers.
 *
 * `address` and `centroid` are Kartverket products too - addresses come from the Adresse
 * API and a centroid is computed from Kartverket's municipality geometry - so they oblige
 * the same NLOD credit. `manual` is a coordinate we typed ourselves and owes nobody
 * anything; it is listed explicitly rather than omitted so that a missing entry below can
 * be treated as a mistake instead of as "no credit needed".
 *
 * The exact wording each licence requires is owned by the geocoding work (phase 2b) and
 * documented in DATA.md. Update the constants above from there, not from memory.
 */
const GEO_CREDITS: Record<GeoSource, DataCredit | null> = {
  osm: OPENSTREETMAP,
  kartverket: KARTVERKET,
  address: KARTVERKET,
  centroid: KARTVERKET,
  manual: null,
};

/** Fixed order, so the footer does not reshuffle itself between builds. */
const ORDER = [OPENSTREETMAP.id, KARTVERKET.id];

/**
 * The credits the current data set actually obliges.
 *
 * Returns an empty list while no venue has coordinates, which is the state today: all 322
 * venues have `lat`/`lon` unset, so the footer shows nothing about maps or geocoding.
 */
export function dataCredits(venues: Venue[]): DataCredit[] {
  const found = new Map<string, DataCredit>();
  const unknown = new Set<string>();

  for (const venue of venues) {
    // A `geoSource` without a coordinate is not a source we are using.
    if (venue.lat == null || venue.lon == null) continue;
    const source = venue.geoSource;
    if (!source) continue;

    if (!(source in GEO_CREDITS)) {
      // A geo source the pipeline added after this table was written. Warn rather than
      // throw: a daily rebuild must not stop. But say it loudly, because the silent
      // failure here is publishing licensed data without the credit it requires.
      unknown.add(source);
      continue;
    }

    const credit = GEO_CREDITS[source];
    if (credit) found.set(credit.id, credit);
  }

  if (unknown.size > 0) {
    console.warn(
      `[attribution] ukjent geoSource uten kreditering: ${[...unknown].join(", ")}. ` +
        "Legg den til i GEO_CREDITS - dette kan være et lisensbrudd.",
    );
  }

  return ORDER.flatMap((id) => {
    const credit = found.get(id);
    return credit ? [credit] : [];
  });
}
