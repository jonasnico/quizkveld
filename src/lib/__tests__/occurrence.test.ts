import { describe, expect, it } from "vitest";

import type { Quiz, Recurrence, Weekday } from "../../../pipeline/schema.js";
import { hasCaveat, isUndated, occurrenceOn, occursOn, splitByDates } from "../occurrence.js";
import { weekWindow } from "../date.js";

function quiz(overrides: Partial<Quiz> & { recurrence: Recurrence }): Quiz {
  return {
    id: "test-quiz",
    venueId: "test-venue",
    weekday: null,
    time: "19:00",
    category: "Allmenn",
    categoryNorm: ["allmenn"],
    lastSeen: "2026-07-28",
    ...overrides,
  };
}

function weekly(weekday: Weekday, day: string): Quiz {
  return quiz({
    weekday,
    recurrence: { kind: "weekly", rrule: `FREQ=WEEKLY;BYDAY=${day}`, raw: `${weekday}er` },
  });
}

// 2026-07-30 is a Thursday.
const THURSDAY = "2026-07-30";
const FRIDAY = "2026-07-31";

describe("weekly quizzes", () => {
  const q = weekly("torsdag", "TH");

  it("is certain on its weekday", () => {
    expect(occurrenceOn(q, THURSDAY)).toBe("certain");
  });

  it("does not occur on other days", () => {
    expect(occurrenceOn(q, FRIDAY)).toBe("no");
  });
});

describe("biweekly quizzes", () => {
  const q = quiz({
    weekday: "tirsdag",
    recurrence: {
      kind: "biweekly",
      rrule: "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2",
      raw: "Annenhver tirsdag",
    },
  });

  it("is only ever likely, never certain", () => {
    // The stored RRULE has no DTSTART, so we know the weekday but not which week of the
    // cycle. Claiming "certain" here would send half the visitors out on the wrong night.
    expect(occurrenceOn(q, "2026-07-28")).toBe("likely");
    expect(occurrenceOn(q, "2026-08-04")).toBe("likely");
  });

  it("still respects the weekday", () => {
    expect(occurrenceOn(q, THURSDAY)).toBe("no");
  });

  it("is listed rather than dropped", () => {
    expect(occursOn(q, "2026-07-28")).toBe(true);
    expect(isUndated(q)).toBe(false);
  });
});

describe("monthly quizzes", () => {
  const secondFriday = quiz({
    weekday: "fredag",
    recurrence: {
      kind: "monthly-nth",
      rrule: "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=2",
      raw: "2. fredag i mnd",
    },
  });

  it("hits the second Friday of the month", () => {
    // Fridays in August 2026: 7, 14, 21, 28.
    expect(occurrenceOn(secondFriday, "2026-08-14")).toBe("certain");
    expect(occurrenceOn(secondFriday, "2026-08-07")).toBe("no");
    expect(occurrenceOn(secondFriday, "2026-08-21")).toBe("no");
  });

  it("works in a month where the rule lands on a different date", () => {
    // Fridays in September 2026: 4, 11, 18, 25.
    expect(occurrenceOn(secondFriday, "2026-09-11")).toBe("certain");
    expect(occurrenceOn(secondFriday, "2026-09-04")).toBe("no");
  });

  it("handles rules that name two positions", () => {
    const firstAndThird = quiz({
      weekday: "fredag",
      recurrence: {
        kind: "monthly-nth",
        rrule: "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,3",
        raw: "Fredag (1. og 3. i mnd)",
      },
    });
    expect(occurrenceOn(firstAndThird, "2026-08-07")).toBe("certain");
    expect(occurrenceOn(firstAndThird, "2026-08-21")).toBe("certain");
    expect(occurrenceOn(firstAndThird, "2026-08-14")).toBe("no");
  });

  it("handles last-of-month, including months with five of the weekday", () => {
    const lastFriday = quiz({
      weekday: "fredag",
      recurrence: {
        kind: "last-of-month",
        rrule: "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
        raw: "Siste fredag i mnd",
      },
    });
    // August 2026 has four Fridays, October 2026 has five.
    expect(occurrenceOn(lastFriday, "2026-08-28")).toBe("certain");
    expect(occurrenceOn(lastFriday, "2026-10-30")).toBe("certain");
    expect(occurrenceOn(lastFriday, "2026-10-23")).toBe("no");
  });

  it("does not depend on when the build runs", () => {
    // rrule defaults DTSTART to "now" when a rule string carries none, which would make
    // every month before the build date look empty. occurrence.ts anchors it instead.
    expect(occurrenceOn(secondFriday, "2020-02-14")).toBe("certain");
    expect(occurrenceOn(secondFriday, "2099-01-09")).toBe("certain");
  });
});

describe("irregular quizzes", () => {
  const noWeekday = quiz({
    weekday: null,
    recurrence: { kind: "irregular", raw: "Torsdag (eller fredag)" },
  });

  const withWeekday = quiz({
    weekday: "sondag",
    recurrence: { kind: "irregular", raw: "Hver fjerde søndag" },
  });

  it("is never placed on a date", () => {
    expect(occurrenceOn(noWeekday, THURSDAY)).toBe("undated");
    expect(occurrenceOn(withWeekday, "2026-08-02")).toBe("undated");
    expect(occursOn(withWeekday, "2026-08-02")).toBe(false);
  });

  it("is flagged as undated even when a weekday is known", () => {
    // The weekday alone is not enough: "Hver fjerde søndag" is genuinely ambiguous, so
    // showing it on every Sunday would be a guess dressed up as a fact.
    expect(isUndated(withWeekday)).toBe(true);
  });
});

describe("splitByDates", () => {
  const items = [
    { quiz: weekly("torsdag", "TH") },
    { quiz: weekly("fredag", "FR") },
    {
      quiz: quiz({
        weekday: "tirsdag",
        recurrence: {
          kind: "biweekly",
          rrule: "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2",
          raw: "Annenhver tirsdag",
        },
      }),
    },
    { quiz: quiz({ weekday: null, recurrence: { kind: "irregular", raw: "Varierer" } }) },
    {
      quiz: quiz({
        weekday: "sondag",
        recurrence: { kind: "irregular", raw: "Omtrent én gang per måned" },
      }),
    },
  ];

  const dates = weekWindow(THURSDAY);
  const { dated, undated } = splitByDates(items, dates);

  it("puts every irregular quiz in the undated bucket", () => {
    expect(undated).toHaveLength(2);
  });

  it("loses nothing: every quiz is either dated somewhere or undated", () => {
    const datedIds = new Set([...dated.values()].flat());
    const accountedFor = new Set([...datedIds, ...undated]);
    expect(accountedFor.size).toBe(items.length);
  });

  it("keeps a key for every date, even empty ones", () => {
    expect([...dated.keys()]).toEqual(dates);
  });

  it("lists a weekly quiz exactly once in a seven-day window", () => {
    const thursdayQuiz = items[0];
    const appearances = [...dated.values()].filter((list) => list.includes(thursdayQuiz!));
    expect(appearances).toHaveLength(1);
  });
});

describe("kildens egne forbehold", () => {
  // Verified against the live dataset: six rows carry a caveat the RRULE cannot express,
  // five of which would otherwise render as fully certain.
  const REAL_CAVEATS = [
    "Torsdag (sent i måneden)",
    "Fredag (siste hver måned, ikke desember)",
    "1. tirsdag hver måned (ikke januar 2025)",
    "Fredag (unntatt sommer)",
    "Torsdag (vanligvis)",
    "Onsdager (annenhver – høstsesong 2024 fra 28/8 til 4/12)",
  ];

  it.each(REAL_CAVEATS)("flags %s", (raw) => {
    expect(hasCaveat(raw)).toBe(true);
  });

  // The badge is only worth anything if it stays rare, so the ordinary phrasings that make
  // up the other 346 rows must not trip it.
  const PLAIN = [
    "Torsdager",
    "Hver tirsdag",
    "Fredag (siste i måneden)",
    "1. tirsdag hver måned",
    "Onsdag (1. onsdag i måneden)",
    "Mandag (den andre i hver måned)",
    "Fredag (1. og 3. i mnd)",
    "Lørdag (siste i mnd)",
  ];

  it.each(PLAIN)("leaves %s alone", (raw) => {
    expect(hasCaveat(raw)).toBe(false);
  });

  it("downgrades a caveated weekly from certain to likely", () => {
    const q = quiz({
      weekday: "fredag",
      recurrence: {
        kind: "weekly",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
        raw: "Fredag (unntatt sommer)",
      },
    });
    expect(occurrenceOn(q, FRIDAY)).toBe("likely");
  });

  it("downgrades a caveated monthly rule too", () => {
    const q = quiz({
      weekday: "torsdag",
      recurrence: {
        kind: "last-of-month",
        rrule: "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=-1",
        raw: "Torsdag (sent i måneden)",
      },
    });
    // 2026-07-30 is the last Thursday of July, so the rule matches - but "sent i" is not
    // "siste", and the source never promised the last one.
    expect(occurrenceOn(q, THURSDAY)).toBe("likely");
  });

  it("still keeps a caveated quiz off days the rule excludes", () => {
    const q = quiz({
      weekday: "fredag",
      recurrence: { kind: "weekly", rrule: "FREQ=WEEKLY;BYDAY=FR", raw: "Fredag (vanligvis)" },
    });
    expect(occurrenceOn(q, THURSDAY)).toBe("no");
  });

  it("never promotes: a caveat cannot turn no into likely", () => {
    const q = quiz({
      weekday: "fredag",
      recurrence: { kind: "weekly", rrule: "FREQ=WEEKLY;BYDAY=FR", raw: "Fredag (ikke juli)" },
    });
    expect(occurrenceOn(q, THURSDAY)).toBe("no");
    expect(occursOn(q, THURSDAY)).toBe(false);
  });

  it("keeps caveated quizzes in dated lists rather than hiding them", () => {
    const q = quiz({
      weekday: "fredag",
      recurrence: {
        kind: "weekly",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
        raw: "Fredag (unntatt sommer)",
      },
    });
    const { dated, undated } = splitByDates([{ quiz: q }], [FRIDAY]);
    expect(undated).toHaveLength(0);
    expect(dated.get(FRIDAY)).toHaveLength(1);
  });
});

