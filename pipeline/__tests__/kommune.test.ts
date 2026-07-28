import { describe, expect, it } from "vitest";
import {
  AliasTableError,
  buildAliasTable,
  checkFylkeConsistency,
  checkInKommune,
  isInNorway,
  kommuneNameVariants,
  normalizePlaceName,
  resolvePlaceName,
  indexKommuner,
} from "../kommune.js";
import { KOMMUNE_FIXTURE, GEOMETRY_FIXTURE } from "./fixtures/kommune.js";

const index = indexKommuner(KOMMUNE_FIXTURE);

describe("normalizePlaceName", () => {
  it("folds case, whitespace and punctuation", () => {
    expect(normalizePlaceName("  Nord-Odal ")).toBe("nordodal");
    expect(normalizePlaceName("NORD ODAL")).toBe("nordodal");
  });

  it("folds the Norwegian vowels so misspellings still land on the same key", () => {
    expect(normalizePlaceName("Greåker")).toBe("greaker");
    expect(normalizePlaceName("Greaaker")).toBe("greaker");
    expect(normalizePlaceName("GREÅKER")).toBe("greaker");
    expect(normalizePlaceName("Nærbø")).toBe("naerbo");
    expect(normalizePlaceName("Naerbo")).toBe("naerbo");
    expect(normalizePlaceName("Ås")).toBe("as");
  });
});

describe("kommuneNameVariants", () => {
  it("splits the Sami dual names Kartverket uses", () => {
    expect(kommuneNameVariants("Sortland - Suortá")).toEqual([
      "Sortland - Suortá",
      "Sortland",
      "Suortá",
    ]);
  });

  it("leaves ordinary hyphenated names alone", () => {
    expect(kommuneNameVariants("Nord-Odal")).toEqual(["Nord-Odal"]);
  });
});

describe("resolvePlaceName", () => {
  it("matches an official kommune name exactly", () => {
    const entry = resolvePlaceName("Sarpsborg", index);
    expect(entry).toMatchObject({
      kommuneNr: "3105",
      kommuneName: "Sarpsborg",
      fylkeNavn: "Østfold",
      resolvedBy: "exact",
    });
  });

  it("maps a locality to the kommune that contains it", () => {
    // Greåker is a place in Sarpsborg, not a kommune. Matching it by name alone would
    // find nothing at all, which is why the manual table exists.
    expect(resolvePlaceName("Greåker", index)).toMatchObject({
      kommuneNr: "3105",
      resolvedBy: "manual",
    });
  });

  it("maps a kommune that was dissolved in 2020 to its successor", () => {
    expect(resolvePlaceName("Rygge", index)).toMatchObject({
      kommuneNr: "3103",
      kommuneName: "Moss",
      resolvedBy: "manual",
    });
  });

  it("resolves a Sami-only official name through the alias table", () => {
    expect(resolvePlaceName("Hamarøy", index)).toMatchObject({
      kommuneNr: "1875",
      resolvedBy: "manual",
    });
  });

  it("matches through the normalizer when only the spelling differs", () => {
    expect(resolvePlaceName("TROMSO", index)).toMatchObject({
      kommuneNr: "5501",
      resolvedBy: "normalized",
    });
  });

  it("refuses to guess between two kommuner with the same name", () => {
    expect(resolvePlaceName("Våler", index)).toMatchObject({ resolvedBy: "unresolved" });
    expect(resolvePlaceName("Våler", index).note).toMatch(/Flertydig/);
  });

  it("reports an unknown place name rather than inventing a kommune", () => {
    expect(resolvePlaceName("Sandnesseter", index)).toMatchObject({
      kommuneNr: null,
      resolvedBy: "unresolved",
    });
  });

  it("fails loudly when the manual table points at a kommune that does not exist", () => {
    const broken = indexKommuner({ ...KOMMUNE_FIXTURE, kommuner: [] });
    expect(() => resolvePlaceName("Greåker", broken)).toThrow(AliasTableError);
  });
});

describe("buildAliasTable", () => {
  it("resolves every place name and sorts the output", () => {
    const table = buildAliasTable(
      ["Tromsø", "Greåker", "Sarpsborg"],
      KOMMUNE_FIXTURE,
      new Date("2026-07-28T00:00:00.000Z"),
    );
    expect(Object.keys(table.aliases)).toEqual(["Greåker", "Sarpsborg", "Tromsø"]);
    expect(table.generatedAt).toBe("2026-07-28T00:00:00.000Z");
  });
});

describe("checkFylkeConsistency", () => {
  const table = buildAliasTable(["Greåker", "Tromsø"], KOMMUNE_FIXTURE);

  it("is quiet when the pre-2020 fylke maps to the kommune's current fylke", () => {
    expect(
      checkFylkeConsistency([{ kommune: "Greåker", fylke: "Østfold" }], table),
    ).toEqual([]);
  });

  it("flags a mapping that lands in the wrong part of the country", () => {
    const mismatches = checkFylkeConsistency(
      [{ kommune: "Greåker", fylke: "Troms" }],
      table,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ expected: "Troms", actual: "Østfold" });
  });
});

describe("isInNorway", () => {
  it("accepts mainland coordinates", () => {
    expect(isInNorway(59.9106, 10.7501)).toBe(true);
    expect(isInNorway(69.6492, 18.9553)).toBe(true);
  });

  it("accepts Svalbard, which falls outside the mainland box", () => {
    expect(isInNorway(78.2232, 15.6469)).toBe(true);
    expect(isInNorway(74.5, 19.0)).toBe(true);
  });

  it("rejects coordinates far outside the country", () => {
    expect(isInNorway(51.5074, -0.1278)).toBe(false);
    expect(isInNorway(40.7128, -74.006)).toBe(false);
    expect(isInNorway(0, 0)).toBe(false);
  });
});

describe("checkInKommune", () => {
  it("accepts a point inside the kommune", () => {
    expect(checkInKommune(59.25, 11.1, "3105", GEOMETRY_FIXTURE)).toBe("inside");
  });

  it("rejects a point in a different kommune", () => {
    // The classic false positive: the right venue name in the wrong town.
    expect(checkInKommune(63.4224, 10.3954, "3105", GEOMETRY_FIXTURE)).toBe("outside");
  });

  it("tolerates a point just outside the simplified border", () => {
    // ~670 m north of the fixture's northern edge, well inside the 1.5 km tolerance.
    expect(checkInKommune(59.406, 11.1, "3105", GEOMETRY_FIXTURE)).toBe("inside");
  });

  it("rejects a point clearly outside the border but inside the bbox padding", () => {
    expect(checkInKommune(59.45, 11.1, "3105", GEOMETRY_FIXTURE)).toBe("outside");
  });

  it("respects holes in the polygon", () => {
    expect(checkInKommune(59.34, 11.05, "3105", GEOMETRY_FIXTURE)).toBe("outside");
  });

  it("uses a bounding box for Svalbard, which has no polygon", () => {
    expect(checkInKommune(78.2232, 15.6469, "2100", GEOMETRY_FIXTURE)).toBe("inside");
    expect(checkInKommune(59.9106, 10.7501, "2100", GEOMETRY_FIXTURE)).toBe("outside");
  });

  it("says so when there is no geometry rather than quietly accepting", () => {
    expect(checkInKommune(59.25, 11.1, "9999", GEOMETRY_FIXTURE)).toBe("unknown");
    expect(checkInKommune(59.25, 11.1, "3105", null)).toBe("unknown");
  });
});
