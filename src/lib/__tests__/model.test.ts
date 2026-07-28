import { describe, expect, it } from "vitest";

import type { Quiz, Venue } from "../../../pipeline/schema.js";
import {
  byTimeThenName,
  countByCategory,
  groupBy,
  hasCategory,
  joinQuizzes,
  placeSummary,
  sortQuizzes,
  type QuizAtVenue,
} from "../model.js";

function venue(id: string, name: string, kommune = "Oslo", fylke = "Oslo"): Venue {
  return { id, name, rawName: name, kommune, fylke };
}

function quiz(id: string, venueId: string, overrides: Partial<Quiz> = {}): Quiz {
  return {
    id,
    venueId,
    weekday: "torsdag",
    time: "19:00",
    recurrence: { kind: "weekly", rrule: "FREQ=WEEKLY;BYDAY=TH", raw: "Torsdager" },
    category: "Allmenn",
    categoryNorm: ["allmenn"],
    lastSeen: "2026-07-28",
    ...overrides,
  };
}

function pair(q: Quiz, v: Venue): QuizAtVenue {
  return { quiz: q, venue: v };
}

describe("joinQuizzes", () => {
  it("joins quizzes to their venue", () => {
    const venues = [venue("a", "Alfa"), venue("b", "Beta")];
    const quizzes = [quiz("q1", "a"), quiz("q2", "b")];
    const { items, orphans } = joinQuizzes(quizzes, venues);
    expect(items).toHaveLength(2);
    expect(orphans).toEqual([]);
  });

  it("reports quizzes whose venue is missing instead of rendering them venue-less", () => {
    const { items, orphans } = joinQuizzes([quiz("q1", "gone")], [venue("a", "Alfa")]);
    expect(items).toEqual([]);
    expect(orphans).toEqual(["q1"]);
  });
});

describe("sorting", () => {
  const a = venue("a", "Alfa");
  const b = venue("b", "Beta");

  it("sorts by start time", () => {
    const early = pair(quiz("q1", "a", { time: "18:00" }), a);
    const late = pair(quiz("q2", "b", { time: "21:00" }), b);
    expect(sortQuizzes([late, early])).toEqual([early, late]);
  });

  it("puts quizzes without a time last, not first", () => {
    // The source writes "?" for 16 quizzes. Treating that as 00:00 would float them to the
    // top of every evening, reading as "these start first" - the opposite of what we know.
    const timed = pair(quiz("q1", "a", { time: "21:00" }), a);
    const untimed = pair(quiz("q2", "b", { time: null }), b);
    expect(sortQuizzes([untimed, timed])).toEqual([timed, untimed]);
    expect(byTimeThenName(untimed, timed)).toBeGreaterThan(0);
  });

  it("keeps two untimed quizzes in name order rather than shuffling them", () => {
    const first = pair(quiz("q1", "a", { time: null }), a);
    const second = pair(quiz("q2", "b", { time: null }), b);
    expect(sortQuizzes([second, first])).toEqual([first, second]);
  });

  it("breaks ties on venue name with Norwegian collation", () => {
    const aa = pair(quiz("q1", "x", { time: "19:00" }), venue("x", "Ålesund Pub"));
    const zz = pair(quiz("q2", "y", { time: "19:00" }), venue("y", "Zebra Bar"));
    // Å sorts after Z in Norwegian.
    expect(sortQuizzes([aa, zz])).toEqual([zz, aa]);
  });
});

describe("category filtering", () => {
  const multi = quiz("q1", "a", { categoryNorm: ["allmenn", "musikk", "film"] });
  const single = quiz("q2", "b", { categoryNorm: ["sport"] });

  it("matches on contains, not equality", () => {
    // 23 quizzes name more than one genre. An equality check would hide every one of them
    // from all but their first genre.
    expect(hasCategory(multi, "musikk")).toBe(true);
    expect(hasCategory(multi, "film")).toBe(true);
    expect(hasCategory(multi, "sport")).toBe(false);
    expect(hasCategory(single, "sport")).toBe(true);
  });

  it("counts a multi-genre quiz once per genre, so the buckets overlap", () => {
    const items = [pair(multi, venue("a", "Alfa")), pair(single, venue("b", "Beta"))];
    const counts = countByCategory(items);
    expect(counts.get("allmenn")).toBe(1);
    expect(counts.get("musikk")).toBe(1);
    expect(counts.get("film")).toBe(1);
    expect(counts.get("sport")).toBe(1);

    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(items.length);
  });
});

describe("grouping", () => {
  it("orders group keys with Norwegian collation", () => {
    const items = [
      pair(quiz("q1", "a"), venue("a", "A", "Ås")),
      pair(quiz("q2", "b"), venue("b", "B", "Bergen")),
      pair(quiz("q3", "c"), venue("c", "C", "Ørsta")),
    ];
    expect([...groupBy(items, (i) => i.venue.kommune).keys()]).toEqual([
      "Bergen",
      "Ørsta",
      "Ås",
    ]);
  });
});

describe("placeSummary", () => {
  it("counts quizzes per place and sorts them for a picker", () => {
    const items = [
      pair(quiz("q1", "a"), venue("a", "A", "Tromsø", "Troms")),
      pair(quiz("q2", "b"), venue("b", "B", "Tromsø", "Troms")),
      pair(quiz("q3", "c"), venue("c", "C", "Bergen", "Hordaland")),
    ];
    expect(placeSummary(items)).toEqual([
      { sted: "Bergen", fylke: "Hordaland", count: 1 },
      { sted: "Tromsø", fylke: "Troms", count: 2 },
    ]);
  });
});
