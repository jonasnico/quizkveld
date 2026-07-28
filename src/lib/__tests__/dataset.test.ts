import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { QuizDataSchema } from "../../../pipeline/schema.js";
import { addDays, weekWindow } from "../date.js";
import { isUndated, occursOn, splitByDates } from "../occurrence.js";
import { buildPlaceSlugs } from "../place.js";
import { countByCategory, joinQuizzes, sortQuizzes } from "../model.js";

/**
 * Checks the site logic against the dataset that will actually be published.
 *
 * These are guard rails, not fixtures: they assert properties that must hold whatever the
 * source publishes next week, rather than today's exact numbers. The one thing they are
 * strict about is that no quiz may fall out of the site silently.
 */

const raw = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "data", "quizzes.json"),
  "utf8",
);
const data = QuizDataSchema.parse(JSON.parse(raw));
const { items, orphans } = joinQuizzes(data.quizzes, data.venues);

describe("the published dataset", () => {
  it("validates against the pipeline schema", () => {
    expect(data.quizzes.length).toBeGreaterThan(250);
    expect(data.venues.length).toBeGreaterThan(200);
  });

  it("has no quiz pointing at a venue that does not exist", () => {
    expect(orphans).toEqual([]);
  });

  it("gives every place and county a unique URL", () => {
    const { bySted, byFylke } = buildPlaceSlugs(data.venues);
    expect(new Set(bySted.values()).size).toBe(bySted.size);
    expect(new Set(byFylke.values()).size).toBe(byFylke.size);
  });
});

describe("no quiz disappears", () => {
  const dates = weekWindow("2026-07-30");
  const { dated, undated } = splitByDates(items, dates);

  it("accounts for every quiz as either datable or undated", () => {
    const undatedIds = new Set(undated.map((item) => item.quiz.id));
    const datableIds = new Set(
      items.filter((item) => !isUndated(item.quiz)).map((item) => item.quiz.id),
    );
    expect(undatedIds.size + datableIds.size).toBe(items.length);
  });

  it("puts every irregular quiz in the undated bucket, including those with a weekday", () => {
    const irregular = items.filter((item) => item.quiz.recurrence.kind === "irregular");
    expect(irregular.length).toBeGreaterThan(0);
    const undatedIds = new Set(undated.map((item) => item.quiz.id));
    for (const item of irregular) {
      expect(undatedIds.has(item.quiz.id)).toBe(true);
    }
  });

  it("keeps the quizzes with no weekday at all", () => {
    const noWeekday = items.filter((item) => item.quiz.weekday === null);
    expect(noWeekday.length).toBeGreaterThan(0);
    const undatedIds = new Set(undated.map((item) => item.quiz.id));
    for (const item of noWeekday) {
      expect(undatedIds.has(item.quiz.id)).toBe(true);
    }
  });

  it("never renders an undated quiz on a date", () => {
    for (const item of undated) {
      for (const date of dates) {
        expect(occursOn(item.quiz, date)).toBe(false);
      }
    }
  });

  it("places every datable quiz on at least one day within five weeks", () => {
    // A week is not long enough: monthly rules legitimately skip whole weeks. Five weeks
    // guarantees every monthly position comes round, so anything still missing here would
    // be a quiz the site can never show on a date.
    const window = Array.from({ length: 35 }, (_, offset) => addDays("2026-07-30", offset));
    const missing = items
      .filter((item) => !isUndated(item.quiz))
      .filter((item) => !window.some((date) => occursOn(item.quiz, date)))
      .map((item) => item.quiz.id);
    expect(missing).toEqual([]);
  });

  it("lists a weekly quiz exactly once per seven-day window", () => {
    const weekly = items.find((item) => item.quiz.recurrence.kind === "weekly");
    expect(weekly).toBeDefined();
    const appearances = [...dated.values()].filter((list) => list.includes(weekly!));
    expect(appearances).toHaveLength(1);
  });
});

describe("categories", () => {
  it("has quizzes naming more than one genre", () => {
    const multi = items.filter((item) => item.quiz.categoryNorm.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it("counts genres into overlapping buckets, so they sum above the quiz count", () => {
    const counts = countByCategory(items);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(items.length);
  });
});

describe("sorting the real data", () => {
  const sorted = sortQuizzes(items);

  it("keeps every quiz", () => {
    expect(sorted).toHaveLength(items.length);
  });

  it("puts all the untimed quizzes after all the timed ones", () => {
    const firstUntimed = sorted.findIndex((item) => item.quiz.time === null);
    if (firstUntimed === -1) return;
    expect(sorted.slice(firstUntimed).every((item) => item.quiz.time === null)).toBe(true);
  });
});
