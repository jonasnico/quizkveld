import { describe, expect, it } from "vitest";
import { OverpassProvider, buildOverpassQuery, candidateNames, elementsToCandidates } from "../geo/overpass.js";
import { haversineMeters, simplifyRing } from "../geo/geometry.js";
import { backoffDelay, isRetryable } from "../geo/http.js";
import {
  MIN_FUZZY_SCORE,
  levenshtein,
  normalizeVenueName,
  pickBest,
  scoreName,
  tokenize,
} from "../geo/match.js";
import { CentroidProvider } from "../geo/centroid.js";
import { extractAddress } from "../geo/kartverket.js";
import { GEOMETRY_FIXTURE } from "./fixtures/kommune.js";
import { OSM_POOL_SARPSBORG, OSM_POOL_TRONDHEIM } from "./fixtures/osm.js";
import type { Venue } from "../schema.js";

function venue(partial: Partial<Venue> & Pick<Venue, "id" | "name">): Venue {
  return {
    rawName: partial.name,
    kommune: "Sarpsborg",
    fylke: "Østfold",
    kommuneNr: "3105",
    kommuneName: "Sarpsborg",
    fylkeNow: "Østfold",
    ...partial,
  };
}

describe("normalizeVenueName", () => {  it("strips guillemets, punctuation and the Norwegian vowels", () => {
    expect(normalizeVenueName("«Hullet i veggen»")).toBe("hullet i veggen");
    expect(normalizeVenueName("Fru Burums")).toBe("fru burums");
    expect(normalizeVenueName("Bølgen Kro")).toBe("bolgen kro");
    expect(normalizeVenueName("Kaffe & Kanel")).toBe("kaffe og kanel");
  });
});

describe("tokenize", () => {
  it("drops words that say what kind of place it is", () => {
    expect(tokenize("Bølgen Kro")).toEqual(["bolgen"]);
    expect(tokenize("Dickens Pub")).toEqual(["dickens"]);
  });

  it("keeps the generic word when it is the whole name", () => {
    expect(tokenize("Kroa")).toEqual(["kroa"]);
    expect(tokenize("The Pub")).toEqual(["the", "pub"]);
  });
});

describe("levenshtein", () => {
  it("counts single edits", () => {
    expect(levenshtein("samfundet", "samfunnet")).toBe(1);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("scoreName", () => {
  it("calls an identical name an exact match", () => {
    expect(scoreName("Samfundet", "Samfundet")).toMatchObject({ kind: "exact" });
    expect(scoreName("«Hullet i veggen»", "Hullet i veggen")).toMatchObject({
      kind: "exact",
    });
  });

  it("treats a dropped generic suffix as exact", () => {
    expect(scoreName("Dickens Pub", "Dickens")).toMatchObject({ kind: "exact" });
  });

  it("matches a name that carries a district along", () => {
    const match = scoreName("Hvaskjer, Torshov", "Hvaskjer");
    expect(match?.kind).toBe("fuzzy");
  });

  it("refuses names that merely look similar", () => {
    expect(scoreName("Bølgen", "Bølgeplassen")).toBeNull();
    expect(scoreName("Skatten", "Skaugum")).toBeNull();
    expect(scoreName("Boxer", "Bakeriet")).toBeNull();
  });

  it("keeps the fuzzy threshold where a single typo still passes", () => {
    const match = scoreName("Samfundet", "Samfunnet");
    expect(match).not.toBeNull();
    expect(match?.score).toBeGreaterThanOrEqual(MIN_FUZZY_SCORE);
  });
});

describe("pickBest", () => {
  const distanceMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    haversineMeters([a.lon, a.lat], [b.lon, b.lat]);

  it("returns nothing when two equally good candidates are far apart", () => {
    const scored = [
      {
        candidate: { name: "Samfundet", lat: 63.42, lon: 10.39 },
        match: { kind: "exact" as const, score: 1 },
      },
      {
        candidate: { name: "Samfundet", lat: 63.5, lon: 10.6 },
        match: { kind: "exact" as const, score: 1 },
      },
    ];
    expect(pickBest(scored, { distanceMeters })).toBeNull();
  });

  it("accepts duplicates of the same place a few metres apart", () => {
    const scored = [
      {
        candidate: { name: "Samfundet", lat: 63.4224, lon: 10.3954 },
        match: { kind: "exact" as const, score: 1 },
      },
      {
        candidate: { name: "Samfundet", lat: 63.4225, lon: 10.3955 },
        match: { kind: "exact" as const, score: 1 },
      },
    ];
    expect(pickBest(scored, { distanceMeters })?.candidate.lat).toBe(63.4224);
  });
});

describe("candidateNames", () => {
  it("collects every tag a name can hide in, alt_name lists included", () => {
    expect(
      candidateNames({ name: "Dickens", alt_name: "Dickens Pub;Dickens Bar", amenity: "pub" }),
    ).toEqual(["Dickens", "Dickens Pub", "Dickens Bar"]);
  });
});

describe("buildOverpassQuery", () => {
  it("uses the kommune bounding box in Overpass's south,west,north,east order", () => {
    const query = buildOverpassQuery([10.95, 59.09, 11.35, 59.4]);
    expect(query).toContain("(59.09,10.95,59.4,11.35)");
    expect(query).toContain("out center tags;");
  });
});

describe("OverpassProvider", () => {
  function provider(pool: ReturnType<typeof elementsToCandidates>) {
    const instance = new OverpassProvider({
      geometry: GEOMETRY_FIXTURE,
      fetchPool: async () => pool,
    });
    return instance;
  }

  it("places a venue on an exact name match inside the right kommune", async () => {
    const instance = provider(OSM_POOL_SARPSBORG);
    const hit = await instance.lookup(venue({ id: "sarpsborg-dickens", name: "Dickens" }));
    expect(hit).toMatchObject({ geoSource: "osm", geoConfidence: "high" });
    expect(hit?.lat).toBeCloseTo(59.2839, 3);
    expect(instance.rejected).toHaveLength(0);
  });

  it("rejects the right name in the wrong kommune instead of downgrading it", async () => {
    // Samfundet exists in Sarpsborg's pool only as the Trondheim one, dragged in by a
    // bounding box. Accepting it would send someone 400 km up the country.
    const instance = provider(OSM_POOL_TRONDHEIM);
    const hit = await instance.lookup(venue({ id: "sarpsborg-samfundet", name: "Samfundet" }));
    expect(hit).toBeNull();
    expect(instance.rejected).toHaveLength(1);
    expect(instance.rejected[0]).toMatchObject({
      candidateName: "Samfundet",
      reason: "utenfor-kommunen",
    });
  });

  it("returns nothing when no candidate name is close enough", async () => {
    const instance = provider(OSM_POOL_SARPSBORG);
    expect(await instance.lookup(venue({ id: "x", name: "Quizkverna" }))).toBeNull();
  });

  it("does nothing for a venue whose kommune could not be resolved", async () => {
    const instance = provider(OSM_POOL_SARPSBORG);
    const unresolved = venue({ id: "y", name: "Dickens" });
    delete unresolved.kommuneNr;
    expect(await instance.lookup(unresolved)).toBeNull();
  });

  it("fetches each kommune once and reuses the pool", async () => {
    let calls = 0;
    const instance = new OverpassProvider({
      geometry: GEOMETRY_FIXTURE,
      fetchPool: async () => {
        calls += 1;
        return OSM_POOL_SARPSBORG;
      },
    });
    await instance.lookup(venue({ id: "a", name: "Dickens" }));
    await instance.lookup(venue({ id: "b", name: "Bølgen Kro" }));
    expect(calls).toBe(1);
  });

  it("survives an Overpass outage without failing the run", async () => {
    const instance = new OverpassProvider({
      geometry: GEOMETRY_FIXTURE,
      fetchPool: async () => {
        throw new Error("504 Gateway Timeout");
      },
    });
    expect(await instance.lookup(venue({ id: "a", name: "Dickens" }))).toBeNull();
  });
});

describe("extractAddress", () => {
  it("prefers the address the parser already pulled out", () => {
    expect(
      extractAddress(venue({ id: "a", name: "Kaffe", addressHint: "Kirkeveien 104" })),
    ).toBe("Kirkeveien 104");
  });

  it("finds an address left inline in the raw name", () => {
    expect(
      extractAddress(venue({ id: "b", name: "Pokalen", rawName: "Pokalen Parkveien 3" })),
    ).toBe("Parkveien 3");
  });

  it("returns nothing when there is no address to find", () => {
    expect(extractAddress(venue({ id: "c", name: "Samfundet" }))).toBeNull();
  });
});

describe("CentroidProvider", () => {
  it("places a venue in a kommune with only a handful of venues", async () => {
    const provider = new CentroidProvider({
      geometry: GEOMETRY_FIXTURE,
      venuesPerKommune: new Map([["3105", 2]]),
    });
    const hit = await provider.lookup(venue({ id: "a", name: "Grendehuset" }));
    expect(hit).toMatchObject({ geoSource: "centroid", geoConfidence: "low" });
    expect(hit?.lat).toBe(59.255);
  });

  it("refuses to stack a whole city on one point", async () => {
    const provider = new CentroidProvider({
      geometry: GEOMETRY_FIXTURE,
      venuesPerKommune: new Map([["3105", 120]]),
    });
    expect(await provider.lookup(venue({ id: "a", name: "Grendehuset" }))).toBeNull();
    expect(provider.skipped).toEqual(["a"]);
  });
});

describe("backoff", () => {
  it("retries the transient statuses and nothing else", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(504)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(400)).toBe(false);
  });

  it("grows the delay steeply so a struggling service gets left alone", () => {
    expect(backoffDelay(1)).toBe(2_000);
    expect(backoffDelay(2)).toBe(8_000);
    expect(backoffDelay(3)).toBe(32_000);
  });
});

describe("simplifyRing", () => {
  it("drops points that add nothing at the given tolerance", () => {
    // A straight north-south line sampled every ~1 km, with no real detail in it.
    const ring: Array<[number, number]> = [
      [10.0, 59.0],
      [10.0, 59.01],
      [10.0, 59.02],
      [10.0, 59.03],
      [10.1, 59.03],
      [10.1, 59.0],
      [10.0, 59.0],
    ];
    const simplified = simplifyRing(ring, 200);
    expect(simplified.length).toBeLessThan(ring.length);
    expect(simplified[0]).toEqual(simplified[simplified.length - 1]);
  });

  it("keeps a shape that would otherwise disappear", () => {
    const triangle: Array<[number, number]> = [
      [10, 59],
      [10.001, 59],
      [10, 59.001],
      [10, 59],
    ];
    expect(simplifyRing(triangle, 5_000)).toEqual(triangle);
  });
});
