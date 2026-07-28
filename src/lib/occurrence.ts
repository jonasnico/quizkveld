// rrule 2.x ships a UMD bundle whose named exports Node's ESM loader cannot detect,
// so we take the default export and destructure it ourselves - same as pipeline/recurrence.ts.
import rrulePkg from "rrule";
import type { Quiz } from "../../pipeline/schema.js";
import { partsOf, weekdayOf, type CivilDate } from "./date.js";

const { RRule } = rrulePkg;

/**
 * Answers "is this quiz on tonight?" for a given Norwegian calendar date.
 *
 * The honest answer is not always yes or no. The dataset contains three genuinely
 * different situations, and collapsing them would send people to a pub on the wrong night:
 *
 * - `certain`  - the rule pins the quiz to this date (weekly, and the monthly rules).
 * - `likely`   - the weekday is right but the week is not knowable. Every `biweekly` rule
 *                is like this: the RRULE has no DTSTART, so we know it runs every other
 *                Tuesday but not *which* Tuesday. 48 quizzes are in this bucket, so
 *                dropping them would gut the site, and promoting them to `certain` would
 *                be a lie. They are shown with a "sjekk selv" badge.
 *                Quizzes whose source text carries a caveat the RRULE cannot express land
 *                here too - see `hasCaveat`.
 * - `undated`  - no date can be derived at all. The 20 `irregular` quizzes, whose raw text
 *                says things like "Hver fjerde søndag" or "Torsdag (eller fredag)". These
 *                never appear in a dated list; they get their own section that quotes the
 *                source text verbatim.
 */
export type Occurrence = "certain" | "likely" | "no" | "undated";

/**
 * Words that mean the recurrence rule is narrower than the source text.
 *
 * An RRULE can say "the last Friday of every month" but not "except December", so a rule
 * built from `Fredag (siste hver måned, ikke desember)` is wrong once a year, and one built
 * from `Torsdag (sent i måneden)` is a guess about what "late" means. Six of the 352 rows
 * carry something like this, five of which would otherwise render as `certain`:
 *
 *   Torsdag (sent i måneden)                        - "late" is not "last"
 *   Fredag (siste hver måned, ikke desember)        - fires in December
 *   1. tirsdag hver måned (ikke januar 2025)        - fires in January
 *   Fredag (unntatt sommer)                         - fires all summer
 *   Torsdag (vanligvis)                             - the source hedges itself
 *   Onsdager (annenhver – høstsesong 2024 fra 28/8 til 4/12)  - a season that has ended
 *
 * Matching on words rather than on ids means new caveats are caught the day the source
 * writes them, without anyone here noticing first. The list is deliberately short: a false
 * positive puts "sjekk selv" on a quiz that runs like clockwork, and a badge that shows up
 * everywhere is a badge nobody reads.
 */
const CAVEAT =
  /\b(ikke|unntatt|utenom|vanligvis|som regel|av og til|sjelden|foreløpig|omtrent|cirka|ca\.)\b|\b(sent|tidlig) i\b|sesong/i;

export function hasCaveat(raw: string): boolean {
  return CAVEAT.test(raw);
}

/** Whether a quiz can ever be placed on a calendar at all. */
export function isUndated(quiz: Quiz): boolean {
  if (quiz.recurrence.kind === "irregular") return true;
  if (quiz.weekday === null) return true;
  if (quiz.recurrence.kind !== "weekly" && quiz.recurrence.kind !== "biweekly") {
    return quiz.recurrence.rrule === undefined;
  }
  return false;
}

function matchesMonthlyRule(rrule: string, date: CivilDate): boolean {
  const { year, month } = partsOf(date);

  // The stored RRULE bodies carry no DTSTART, so rrule would default it to "now" and
  // report nothing for any month before the build date. Anchoring it to the first of the
  // month being asked about makes the answer depend only on the rule and the date.
  const options = RRule.parseString(rrule);
  options.dtstart = new Date(Date.UTC(year, month - 1, 1));

  const rule = new RRule(options);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  return rule
    .between(monthStart, monthEnd, true)
    .some((occurrence) => occurrence.toISOString().slice(0, 10) === date);
}

export function occurrenceOn(quiz: Quiz, date: CivilDate): Occurrence {
  const result = occurrenceFromRule(quiz, date);
  // A caveat can only ever soften the answer, never harden it.
  if (result === "certain" && hasCaveat(quiz.recurrence.raw)) return "likely";
  return result;
}

function occurrenceFromRule(quiz: Quiz, date: CivilDate): Occurrence {
  if (isUndated(quiz)) return "undated";

  // Guarded by isUndated, but narrowing needs the check.
  if (quiz.weekday === null) return "undated";

  switch (quiz.recurrence.kind) {
    case "weekly":
      return weekdayOf(date) === quiz.weekday ? "certain" : "no";

    case "biweekly":
      return weekdayOf(date) === quiz.weekday ? "likely" : "no";

    case "monthly-nth":
    case "last-of-month": {
      const { rrule } = quiz.recurrence;
      if (!rrule) return "undated";
      // The weekday check is cheap and short-circuits the vast majority of calls.
      if (weekdayOf(date) !== quiz.weekday) return "no";
      return matchesMonthlyRule(rrule, date) ? "certain" : "no";
    }

    case "irregular":
      return "undated";
  }
}

/** True when the quiz should be listed under the given date. */
export function occursOn(quiz: Quiz, date: CivilDate): boolean {
  const occurrence = occurrenceOn(quiz, date);
  return occurrence === "certain" || occurrence === "likely";
}

/**
 * Splits a set of quizzes into the ones that can be placed on the given dates and the ones
 * that cannot be dated at all. Returning both halves from one call is deliberate: it makes
 * it hard to render a dated list and forget the undated remainder, which is how those 20
 * quizzes would quietly disappear from the site.
 */
export function splitByDates<T extends { quiz: Quiz }>(
  items: T[],
  dates: CivilDate[],
): { dated: Map<CivilDate, T[]>; undated: T[] } {
  const dated = new Map<CivilDate, T[]>(dates.map((date) => [date, []]));
  const undated: T[] = [];

  for (const item of items) {
    if (isUndated(item.quiz)) {
      undated.push(item);
      continue;
    }
    for (const date of dates) {
      if (occursOn(item.quiz, date)) {
        dated.get(date)?.push(item);
      }
    }
  }

  return { dated, undated };
}
