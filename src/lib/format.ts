import type { CategoryNorm, Recurrence, Weekday } from "../../pipeline/schema.js";
import { addDays, weekdayOf, type CivilDate } from "./date.js";

/** Norwegian display strings. Everything the visitor reads is built here. */

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mandag: "Mandag",
  tirsdag: "Tirsdag",
  onsdag: "Onsdag",
  torsdag: "Torsdag",
  fredag: "Fredag",
  lordag: "Lørdag",
  sondag: "Søndag",
};

const CATEGORY_LABELS: Record<CategoryNorm, string> = {
  allmenn: "Allmenn",
  musikk: "Musikk",
  sport: "Sport",
  film: "Film",
  annet: "Annet",
};

const MONTHS = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
] as const;

export function weekdayLabel(weekday: Weekday): string {
  return WEEKDAY_LABELS[weekday];
}

export function categoryLabel(category: CategoryNorm): string {
  return CATEGORY_LABELS[category];
}

/** Joins the genres of a quiz, e.g. "Allmenn, musikk og film". */
export function categoryList(categories: readonly CategoryNorm[]): string {
  const labels = categories.map((category, index) =>
    index === 0 ? categoryLabel(category) : categoryLabel(category).toLowerCase(),
  );
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} og ${labels.at(-1)}`;
}

/**
 * 16 quizzes have no start time because the source writes "?" there. Saying so is more
 * useful than an em dash, and far more useful than inventing 00:00.
 */
export function timeLabel(time: string | null): string {
  return time ?? "Tidspunkt ikke oppgitt";
}

/** "27. juli 2026" */
export function longDate(date: CivilDate): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${day}. ${MONTHS[month - 1]} ${year}`;
}

/** "Torsdag 30. juli", or "I kveld" / "I morgen" when the date is close enough to matter. */
export function dayHeading(date: CivilDate, today: CivilDate): string {
  if (date === today) return "I kveld";
  if (date === addDays(today, 1)) return "I morgen";
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${weekdayLabel(weekdayOf(date))} ${day}. ${MONTHS[month - 1]}`;
}

/** ISO timestamp -> "27. juli 2026 kl. 04:12" in Norwegian time. */
export function timestampLabel(iso: string): string {
  const when = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(when);
  return `${longDate(parts)} kl. ${time}`;
}

/**
 * A short, honest description of how often a quiz runs.
 *
 * For anything we could not turn into a rule, the source's own wording is returned
 * verbatim - it is more informative than any label we could invent, and it is the only
 * thing we actually know.
 */
export function recurrenceLabel(recurrence: Recurrence, weekday: Weekday | null): string {
  const day = weekday ? weekdayLabel(weekday).toLowerCase() : null;

  switch (recurrence.kind) {
    case "weekly":
      return day ? `Hver ${day}` : "Ukentlig";
    case "biweekly":
      return day ? `Annenhver ${day}` : "Annenhver uke";
    case "monthly-nth":
      return recurrence.raw;
    case "last-of-month":
      return day ? `Siste ${day} i måneden` : "Siste i måneden";
    case "irregular":
      return recurrence.raw;
  }
}

/** Norwegian plural for the most common count on the site. */
export function quizCount(count: number): string {
  return count === 1 ? "1 quiz" : `${count} quizer`;
}

export function venueCount(count: number): string {
  return count === 1 ? "1 sted" : `${count} steder`;
}
