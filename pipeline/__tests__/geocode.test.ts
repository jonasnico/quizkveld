import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GeoCache, defaultProviders, runGeocode } from "../geocode.js";
import type { GeoProvider, GeoResult } from "../geocode.js";
import type { Venue } from "../schema.js";

const tempFiles: string[] = [];

async function tempCacheFile(contents?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quizkveld-geo-"));
  const file = path.join(dir, "geocache.json");
  if (contents !== undefined) await fs.writeFile(file, contents, "utf8");
  tempFiles.push(dir);
  return file;
}

afterEach(async () => {
  for (const dir of tempFiles.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const VENUES: Venue[] = [
  {
    id: "oslo-skatten",
    name: "Skatten",
    rawName: "Skatten",
    kommune: "Oslo",
    fylke: "Oslo",
  },
  {
    id: "bergen-kvarteret",
    name: "Kvarteret",
    rawName: "Kvarteret",
    kommune: "Bergen",
    fylke: "Vestland",
  },
];

function provider(name: GeoProvider["name"], result: GeoResult | null): GeoProvider {
  return { name, lookup: async () => result };
}

describe("GeoCache", () => {
  it("starts empty when the file does not exist yet", async () => {
    const cache = await GeoCache.load(await tempCacheFile());
    expect(cache.size).toBe(0);
  });

  it("round-trips entries through disk", async () => {
    const file = await tempCacheFile("{}");
    const cache = await GeoCache.load(file);
    cache.set(
      "oslo-skatten",
      { lat: 59.91, lon: 10.74, geoSource: "address", geoConfidence: "high" },
      new Date("2026-07-28T04:00:00.000Z"),
    );
    await cache.save();

    const reloaded = await GeoCache.load(file);
    expect(reloaded.get("oslo-skatten")).toEqual({
      lat: 59.91,
      lon: 10.74,
      geoSource: "address",
      geoConfidence: "high",
      resolvedAt: "2026-07-28T04:00:00.000Z",
    });
  });

  it("writes keys in sorted order so the committed file diffs cleanly", async () => {
    const file = await tempCacheFile("{}");
    const cache = await GeoCache.load(file);
    const entry: GeoResult = {
      lat: 1,
      lon: 2,
      geoSource: "centroid",
      geoConfidence: "low",
    };
    cache.set("zebra", entry);
    cache.set("alfa", entry);
    await cache.save();
    expect(Object.keys(JSON.parse(await fs.readFile(file, "utf8")))).toEqual([
      "alfa",
      "zebra",
    ]);
  });

  it("rejects corrupt json loudly instead of starting from scratch", async () => {
    const file = await tempCacheFile("{ not json");
    await expect(GeoCache.load(file)).rejects.toThrow(/ugyldig JSON/);
  });
});

describe("runGeocode", () => {
  const EMPTY_REGISTER = { fetchedAt: new Date().toISOString(), source: "test", kommuner: [] };
  const EMPTY_ALIASES = { aliases: {} };

  it("walks the ladder and stops at the first provider that resolves", async () => {
    const cache = await GeoCache.load(await tempCacheFile("{}"));
    const hit: GeoResult = {
      lat: 59.91,
      lon: 10.74,
      geoSource: "osm",
      geoConfidence: "medium",
    };

    const stats = await runGeocode(VENUES, {
      cache,
      register: EMPTY_REGISTER,
      aliases: EMPTY_ALIASES,
      providers: [provider("address", null), provider("osm", hit), provider("kartverket", null)],
    });

    expect(stats).toMatchObject({ total: 2, cached: 0, resolved: 2, unresolved: 0 });
    expect(stats.bySource).toEqual({ osm: 2 });
    expect(stats.byConfidence).toEqual({ medium: 2 });
    expect(cache.get("bergen-kvarteret")?.geoSource).toBe("osm");
  });

  it("skips venues that are already cached", async () => {
    const cache = await GeoCache.load(await tempCacheFile("{}"));
    cache.set("oslo-skatten", {
      lat: 1,
      lon: 2,
      geoSource: "manual",
      geoConfidence: "high",
    });

    let calls = 0;
    const counting: GeoProvider = {
      name: "osm",
      lookup: async () => {
        calls += 1;
        return null;
      },
    };

    const stats = await runGeocode(VENUES, {
      cache,
      register: EMPTY_REGISTER,
      aliases: EMPTY_ALIASES,
      providers: [counting],
    });
    expect(calls).toBe(1);
    expect(stats).toMatchObject({ cached: 1, unresolved: 1 });
    // The cached entry is untouched.
    expect(cache.get("oslo-skatten")?.geoSource).toBe("manual");
  });

  it("keeps going when a provider throws, so one outage cannot lose the whole run", async () => {
    const cache = await GeoCache.load(await tempCacheFile("{}"));
    const exploding: GeoProvider = {
      name: "osm",
      lookup: async () => {
        throw new Error("Overpass er nede");
      },
    };
    const fallback = provider("centroid", {
      lat: 60.39,
      lon: 5.32,
      geoSource: "centroid",
      geoConfidence: "low",
    });

    const stats = await runGeocode(VENUES, {
      cache,
      register: EMPTY_REGISTER,
      aliases: EMPTY_ALIASES,
      providers: [exploding, fallback],
    });

    expect(stats.resolved).toBe(2);
    expect(stats.bySource).toEqual({ centroid: 2 });
    expect(stats.lowConfidence).toHaveLength(2);
  });

  it("stops after the requested number of new lookups", async () => {
    const cache = await GeoCache.load(await tempCacheFile("{}"));
    const stats = await runGeocode(VENUES, {
      cache,
      register: EMPTY_REGISTER,
      aliases: EMPTY_ALIASES,
      limit: 1,
      providers: [
        provider("osm", { lat: 59.91, lon: 10.74, geoSource: "osm", geoConfidence: "high" }),
      ],
    });
    expect(stats.resolved).toBe(1);
  });

  it("exposes the ladder in the documented order", () => {
    expect(defaultProviders().map((p) => p.name)).toEqual([
      "address",
      "osm",
      "kartverket",
      "centroid",
    ]);
  });
});
