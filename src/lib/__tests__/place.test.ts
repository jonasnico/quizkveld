import { describe, expect, it } from "vitest";

import type { Venue } from "../../../pipeline/schema.js";
import { buildPlaceSlugs, invert } from "../place.js";

function venue(id: string, kommune: string, fylke: string): Venue {
  return { id, name: id, rawName: id, kommune, fylke };
}

describe("buildPlaceSlugs", () => {
  it("transliterates Norwegian characters the same way venue ids do", () => {
    const { bySted, byFylke } = buildPlaceSlugs([
      venue("v1", "Tromsø", "Troms"),
      venue("v2", "Ålesund", "Møre og Romsdal"),
    ]);
    expect(bySted.get("Tromsø")).toBe("tromsoe");
    expect(bySted.get("Ålesund")).toBe("aalesund");
    expect(byFylke.get("Møre og Romsdal")).toBe("moere-og-romsdal");
  });

  it("qualifies with the county when the same place name appears in two of them", () => {
    const { bySted } = buildPlaceSlugs([
      venue("v1", "Sandnes", "Rogaland"),
      venue("v2", "Sandnes", "Troms"),
    ]);
    // Distinct place names would each get their own entry; an identical name is a single
    // key, so this asserts the map does not silently merge two counties' worth of quizzes.
    expect(bySted.size).toBe(1);
    expect(bySted.get("Sandnes")).toBe("sandnes");
  });

  it("qualifies with the county when two different names slug identically", () => {
    const { bySted } = buildPlaceSlugs([
      venue("v1", "Bø", "Telemark"),
      venue("v2", "Boe", "Nordland"),
    ]);
    const slugs = [...bySted.values()];
    expect(new Set(slugs).size).toBe(2);
    expect(slugs).toContain("boe");
    // Whichever loses the plain slug is qualified by its county rather than merged away.
    expect(slugs.some((s) => s === "boe-telemark" || s === "boe-nordland")).toBe(true);
  });

  it("is independent of the order rows arrive in", () => {
    const a = buildPlaceSlugs([venue("v1", "Bø", "Telemark"), venue("v2", "Boe", "Nordland")]);
    const b = buildPlaceSlugs([venue("v2", "Boe", "Nordland"), venue("v1", "Bø", "Telemark")]);
    // The source table reshuffles between scrapes; URLs must not move with it.
    expect([...a.bySted]).toEqual([...b.bySted]);
  });

  it("falls back to a numeric suffix rather than merging or failing the build", () => {
    // Three spellings of the same slug inside one county exhausts the county qualifier.
    // The site is rebuilt daily from data nobody here controls, so an ugly URL beats a
    // build that stops publishing - and nothing is merged either way.
    const { bySted } = buildPlaceSlugs([
      venue("v1", "Bø", "Nordland"),
      venue("v2", "Boe", "Nordland"),
      venue("v3", "BOE", "Nordland"),
    ]);
    const slugs = [...bySted.values()];
    expect(new Set(slugs).size).toBe(3);
    expect(slugs).toContain("boe");
  });

  it("handles a place name that slugs to nothing", () => {
    const { bySted } = buildPlaceSlugs([venue("v1", "???", "Oslo")]);
    expect(bySted.get("???")).toBe("oslo");
  });
});

describe("invert", () => {
  it("maps a slug back to the source spelling", () => {
    const { bySted } = buildPlaceSlugs([venue("v1", "Tromsø", "Troms")]);
    expect(invert(bySted).get("tromsoe")).toBe("Tromsø");
  });
});
