import { WEEKDAYS, type Weekday } from "../../pipeline/schema.js";

/**
 * Civil-date arithmetic pinned to Europe/Oslo.
 *
 * The site is built in CI, which runs in UTC. A naive `new Date().getDay()` therefore
 * reports the wrong evening for every build that starts after 22:00 Oslo time in summer
 * (23:00 in winter) - it would tell someone on Friday night that Saturday's quizzes are
 * "tonight". Every date decision on this site goes through this module, and every function
 * here takes the timezone explicitly.
 *
 * Dates are handled as `YYYY-MM-DD` strings ("civil dates") rather than `Date` objects.
 * A civil date has no time and no offset, which is precisely what "which evening is it in
 * Norway" means, and it makes DST transitions a non-event.
 */

export const OSLO = "Europe/Oslo";

/** A calendar date with no time and no offset, formatted `YYYY-MM-DD`. */
export type CivilDate = string;

const CIVIL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// en-CA formats as YYYY-MM-DD, which is what we want, and is stable across Node versions
// in a way that `toLocaleDateString` with custom parts is not.
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OSLO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: OSLO,
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: OSLO,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * English short weekday names, in the order `Date.prototype.getUTCDay()` uses, mapped to
 * the pipeline's Norwegian enum. We go via English rather than a Norwegian locale because
 * ICU's Norwegian weekday spelling has changed between Node releases, and the enum values
 * are load-bearing (they key the whole weekday filter).
 */
const WEEKDAY_BY_EN: Record<string, Weekday> = {
  Mon: "mandag",
  Tue: "tirsdag",
  Wed: "onsdag",
  Thu: "torsdag",
  Fri: "fredag",
  Sat: "lordag",
  Sun: "sondag",
};

/** The current date in Norway. */
export function osloDate(now: Date = new Date()): CivilDate {
  return dateFormatter.format(now);
}

/** The current clock time in Norway, as `HH:MM`. */
export function osloTime(now: Date = new Date()): string {
  return timeFormatter.format(now);
}

/** The weekday an instant falls on in Norway. */
export function osloWeekday(now: Date = new Date()): Weekday {
  const short = weekdayFormatter.format(now);
  const weekday = WEEKDAY_BY_EN[short];
  if (!weekday) {
    throw new Error(`Unrecognised weekday from Intl: ${short}`);
  }
  return weekday;
}

function assertCivilDate(date: CivilDate): void {
  if (!CIVIL_DATE_RE.test(date)) {
    throw new Error(`Not a civil date: ${date}`);
  }
}

/**
 * Civil dates are manipulated through UTC midnight, which has no DST to trip over: adding
 * 24h to 2026-03-29T00:00Z always lands on 2026-03-30, even though that Norwegian day is
 * only 23 hours long.
 */
function toUtcMidnight(date: CivilDate): Date {
  assertCivilDate(date);
  return new Date(`${date}T00:00:00Z`);
}

function fromUtcMidnight(date: Date): CivilDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = toUtcMidnight(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return fromUtcMidnight(shifted);
}

/** The weekday a civil date falls on. */
export function weekdayOf(date: CivilDate): Weekday {
  const index = toUtcMidnight(date).getUTCDay();
  // getUTCDay() is Sunday-first; WEEKDAYS is Monday-first.
  const weekday = WEEKDAYS[(index + 6) % 7];
  if (!weekday) {
    throw new Error(`Could not map weekday index ${index}`);
  }
  return weekday;
}

/**
 * Seven consecutive days starting today. Deliberately a rolling window rather than
 * Monday-to-Sunday: someone looking on a Saturday wants the coming week, not the two days
 * left of this one.
 */
export function weekWindow(from: CivilDate, days = 7): CivilDate[] {
  return Array.from({ length: days }, (_, offset) => addDays(from, offset));
}

/** Parts of a civil date, for building month-scoped recurrence rules. */
export function partsOf(date: CivilDate): { year: number; month: number; day: number } {
  assertCivilDate(date);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}
