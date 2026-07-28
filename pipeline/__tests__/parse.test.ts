import { describe, expect, it } from "vitest";
import { extractSourceUpdatedAt, parseHtml, splitRowVariants } from "../parse.js";
import { loadFixture } from "./helpers.js";

describe("parseHtml", () => {
  it("reads the 'Sist oppdatert' date from the page", async () => {
    const result = parseHtml(await loadFixture());
    expect(result.sourceUpdatedAt).toBe("2026-07-27");
  });

  it("parses every data row without warnings", async () => {
    const result = parseHtml(await loadFixture());
    // 15 table rows, one of which (Skatten) splits into two quizzes.
    expect(result.rows).toHaveLength(16);
    expect(result.warnings).toEqual([]);
  });

  it("attributes each row to the fylke heading above it", async () => {
    const result = parseHtml(await loadFixture());
    const byFylke = new Map<string, number>();
    for (const row of result.rows) {
      byFylke.set(row.fylke, (byFylke.get(row.fylke) ?? 0) + 1);
    }
    expect(Object.fromEntries(byFylke)).toEqual({
      Østfold: 3,
      Oslo: 8,
      Akershus: 3,
      Troms: 2,
    });
  });

  it("takes the venue url from the venue cell only", async () => {
    const result = parseHtml(await loadFixture());

    const heim = result.rows.find((row) => row.venueRaw.includes("Heim"));
    expect(heim?.venueUrl).toBe("https://www.heim.no/events/heim-quiz#fredrikstad");

    // Unlinked venue.
    const olavs = result.rows.find((row) => row.venueRaw === "Olavs pub");
    expect(olavs?.venueUrl).toBeUndefined();

    // Hells Kitchen has links in the weekday and category cells too; those are
    // decoration and must not be mistaken for the venue url.
    const hells = result.rows.find((row) => row.venueRaw === "Hells Kitchen");
    expect(hells?.venueUrl).toBe("https://www.hellskitchenoslo.no/");
    expect(hells?.weekdayRaw).toBe("Onsdag (oddetallsuker)");
    expect(hells?.categoryRaw).toBe("Allmenn");
  });

  it("splits a row that encodes two quizzes into two rows", async () => {
    const result = parseHtml(await loadFixture());
    const skatten = result.rows.filter((row) => row.venueRaw === "Skatten");
    expect(skatten).toHaveLength(2);
    expect(skatten.map((row) => [row.timeRaw, row.categoryRaw])).toEqual([
      ["18:00", "Allmenn"],
      ["20:30", "Musikk"],
    ]);
    // Both halves keep the shared weekday.
    expect(new Set(skatten.map((row) => row.weekdayRaw))).toEqual(new Set(["Torsdag"]));
  });

  it("decodes html entities and preserves the newline inside a venue name", async () => {
    const result = parseHtml(await loadFixture());

    const marienlyst = result.rows.find((row) => row.venueRaw.startsWith("Café"));
    expect(marienlyst?.venueRaw).toBe(
      "Café Marienlyst\n(«Hullet i veggen»), Kirkeveien 104)",
    );

    const nydalen = result.rows.find((row) => row.venueRaw.startsWith("Nydalen"));
    // &#8211; is an en dash, not a hyphen.
    expect(nydalen?.weekdayRaw).toBe(
      "Onsdager (annenhver – høstsesong 2024 fra 28/8 til 4/12)",
    );
  });

  it("keeps empty and unknown times as raw text for the normalizer to judge", async () => {
    const result = parseHtml(await loadFixture());
    const wembley = result.rows.find((row) => row.venueRaw.startsWith("Wembley"));
    expect(wembley?.timeRaw).toBe("?");

    const kjokkenet = result.rows.find((row) => row.venueRaw.startsWith("Kjøkkenet"));
    expect(kjokkenet?.timeRaw).toBe("");
  });

  it("throws a clear error when the table is missing entirely", () => {
    expect(() => parseHtml("<html><body><p>ingen tabell her</p></body></html>")).toThrow(
      /endret struktur/,
    );
  });
});

describe("extractSourceUpdatedAt", () => {
  it("pads single-digit days and months", () => {
    expect(extractSourceUpdatedAt("Sist oppdatert: 3.9.2025")).toBe("2025-09-03");
  });

  it("returns null when the date is absent", () => {
    expect(extractSourceUpdatedAt("ingen dato her")).toBeNull();
  });
});

describe("splitRowVariants", () => {
  it("pairs equal numbers of segments", () => {
    expect(splitRowVariants("18:00\n20:30", "Allmenn\nMusikk")).toEqual([
      { timeRaw: "18:00", categoryRaw: "Allmenn" },
      { timeRaw: "20:30", categoryRaw: "Musikk" },
    ]);
  });

  it("repeats a single value across several segments", () => {
    expect(splitRowVariants("18:00\n20:30", "Allmenn")).toEqual([
      { timeRaw: "18:00", categoryRaw: "Allmenn" },
      { timeRaw: "20:30", categoryRaw: "Allmenn" },
    ]);
  });

  it("keeps the row intact when the segment counts cannot be reconciled", () => {
    const result = splitRowVariants("18:00\n20:30\n22:00", "Allmenn\nMusikk");
    expect(result).toEqual([
      { timeRaw: "18:00\n20:30\n22:00", categoryRaw: "Allmenn\nMusikk" },
    ]);
  });

  it("leaves single-value cells alone", () => {
    expect(splitRowVariants("19:00", "Allmenn")).toEqual([
      { timeRaw: "19:00", categoryRaw: "Allmenn" },
    ]);
  });
});
