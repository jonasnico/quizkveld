import { describe, expect, it, vi } from "vitest";

import type { Venue } from "../../../pipeline/schema.js";
import { dataCredits } from "../attribution.js";

function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "oslo-et-sted",
    name: "Et sted",
    rawName: "Et sted",
    kommune: "Oslo",
    fylke: "Oslo",
    ...over,
  } as Venue;
}

const oslo = { lat: 59.91, lon: 10.75 };

describe("dataCredits", () => {
  it("credits nobody while no venue has coordinates", () => {
    // This is today's state: all 322 venues are ungeocoded, so the footer must not claim
    // we use OpenStreetMap or Kartverket.
    expect(dataCredits([venue(), venue({ id: "b" })])).toEqual([]);
  });

  it("ignores a geoSource that has no coordinate behind it", () => {
    // A source recorded on a venue we failed to place is not a source we are using.
    expect(dataCredits([venue({ geoSource: "osm" })])).toEqual([]);
  });

  it("credits OpenStreetMap under ODbL when an OSM coordinate is used", () => {
    const credits = dataCredits([venue({ ...oslo, geoSource: "osm" })]);
    expect(credits).toHaveLength(1);
    expect(credits[0]?.label).toBe("© OpenStreetMap-bidragsytere");
    expect(credits[0]?.licence).toBe("ODbL");
  });

  it("credits Kartverket under NLOD for kartverket, address and centroid alike", () => {
    for (const geoSource of ["kartverket", "address", "centroid"] as const) {
      const credits = dataCredits([venue({ ...oslo, geoSource })]);
      expect(credits).toHaveLength(1);
      expect(credits[0]?.id).toBe("kartverket");
      expect(credits[0]?.licence).toBe("NLOD");
    }
  });

  it("collapses the three Kartverket sources into one line", () => {
    const credits = dataCredits([
      venue({ id: "a", ...oslo, geoSource: "kartverket" }),
      venue({ id: "b", ...oslo, geoSource: "address" }),
      venue({ id: "c", ...oslo, geoSource: "centroid" }),
    ]);
    expect(credits.map((c) => c.id)).toEqual(["kartverket"]);
  });

  it("owes nobody anything for a manually placed venue", () => {
    expect(dataCredits([venue({ ...oslo, geoSource: "manual" })])).toEqual([]);
  });

  it("lists both sources in a stable order regardless of venue order", () => {
    const osm = venue({ id: "a", ...oslo, geoSource: "osm" });
    const kv = venue({ id: "b", ...oslo, geoSource: "kartverket" });
    expect(dataCredits([osm, kv]).map((c) => c.id)).toEqual(["osm", "kartverket"]);
    expect(dataCredits([kv, osm]).map((c) => c.id)).toEqual(["osm", "kartverket"]);
  });

  it("warns instead of failing when the pipeline adds a source we have no wording for", () => {
    // Publishing licensed coordinates without their credit is the real risk here, so it
    // has to be loud - but a daily rebuild must not stop over it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rogue = { ...venue({ ...oslo }), geoSource: "nykilde" } as unknown as Venue;

    expect(dataCredits([rogue])).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("nykilde");

    warn.mockRestore();
  });
});
