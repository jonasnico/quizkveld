import { describe, expect, it } from "vitest";

import {
  categoryList,
  dayHeading,
  longDate,
  quizCount,
  recurrenceLabel,
  timeLabel,
  timestampLabel,
  weekdayLabel,
} from "../format.js";

describe("weekdayLabel", () => {
  it("restores the Norwegian letters the id slug had to drop", () => {
    expect(weekdayLabel("lordag")).toBe("Lørdag");
    expect(weekdayLabel("sondag")).toBe("Søndag");
  });
});

describe("timeLabel", () => {
  it("says so when the source gives no time", () => {
    // 16 quizzes have `time: null` because the source writes "?". Rendering 00:00 would be
    // a claim; rendering an em dash would be a shrug.
    expect(timeLabel(null)).toBe("Tidspunkt ikke oppgitt");
    expect(timeLabel("19:00")).toBe("19:00");
  });
});

describe("categoryList", () => {
  it("reads as a Norwegian sentence for multi-genre quizzes", () => {
    expect(categoryList(["allmenn"])).toBe("Allmenn");
    expect(categoryList(["allmenn", "musikk"])).toBe("Allmenn og musikk");
    expect(categoryList(["allmenn", "musikk", "film"])).toBe("Allmenn, musikk og film");
  });
});

describe("dayHeading", () => {
  it("uses tonight and tomorrow where they apply", () => {
    expect(dayHeading("2026-07-30", "2026-07-30")).toBe("I kveld");
    expect(dayHeading("2026-07-31", "2026-07-30")).toBe("I morgen");
  });

  it("names the day otherwise", () => {
    expect(dayHeading("2026-08-01", "2026-07-30")).toBe("Lørdag 1. august");
  });
});

describe("longDate", () => {
  it("formats in Norwegian without a leading zero", () => {
    expect(longDate("2026-07-05")).toBe("5. juli 2026");
    expect(longDate("2026-12-31")).toBe("31. desember 2026");
  });
});

describe("timestampLabel", () => {
  it("renders a UTC timestamp in Norwegian local time", () => {
    // 22:30 UTC on 30 July is 00:30 on 31 July in Oslo. Showing the UTC date here would
    // contradict the "i kveld" the same page computes.
    expect(timestampLabel("2026-07-30T22:30:00Z")).toBe("31. juli 2026 kl. 00:30");
  });

  it("uses the winter offset in winter", () => {
    expect(timestampLabel("2026-01-15T04:00:00Z")).toBe("15. januar 2026 kl. 05:00");
  });
});

describe("recurrenceLabel", () => {
  it("describes the rules we understand", () => {
    expect(
      recurrenceLabel({ kind: "weekly", rrule: "FREQ=WEEKLY;BYDAY=TH", raw: "Torsdager" }, "torsdag"),
    ).toBe("Hver torsdag");
    expect(
      recurrenceLabel(
        { kind: "biweekly", rrule: "FREQ=WEEKLY;BYDAY=TU;INTERVAL=2", raw: "Annenhver tirsdag" },
        "tirsdag",
      ),
    ).toBe("Annenhver tirsdag");
    expect(
      recurrenceLabel(
        { kind: "last-of-month", rrule: "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1", raw: "Siste fredag" },
        "fredag",
      ),
    ).toBe("Siste fredag i måneden");
  });

  it("quotes the source verbatim when we could not read the rule", () => {
    const raw = "Omtrent én gang per måned (sjekk facebookgruppa «Spillquiz i Tromsø»)";
    expect(recurrenceLabel({ kind: "irregular", raw }, null)).toBe(raw);
  });

  it("quotes the source for monthly rules, which carry detail a label would lose", () => {
    expect(
      recurrenceLabel(
        { kind: "monthly-nth", rrule: "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,3", raw: "Fredag (1. og 3. i mnd)" },
        "fredag",
      ),
    ).toBe("Fredag (1. og 3. i mnd)");
  });
});

describe("quizCount", () => {
  it("gets the Norwegian singular right", () => {
    expect(quizCount(0)).toBe("0 quizer");
    expect(quizCount(1)).toBe("1 quiz");
    expect(quizCount(2)).toBe("2 quizer");
  });
});
