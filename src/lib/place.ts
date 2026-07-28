import { slug } from "../../pipeline/slug.js";
import type { Venue } from "../../pipeline/schema.js";

/**
 * URL slugs for places and counties.
 *
 * Two things about the source data shape this module:
 *
 * 1. `kommune` is not a kommune. It is the place name a volunteer typed into a spreadsheet
 *    column, so "Greåker" appears alongside "Sarpsborg" even though the first is inside the
 *    second. We surface it as "sted", never as "kommune", and we do not try to reconcile it
 *    with any official register - that is phase 2b's problem, and guessing here would put
 *    quizzes under the wrong heading.
 *
 * 2. `fylke` uses the pre-2020 county names (Sør-Trøndelag, Hedmark, Vest-Agder, Sogn og
 *    Fjordane) plus Svalbard. We show them exactly as the source writes them.
 *
 * Slugs must be stable, because they are the site's URLs. `slug()` is imported from the
 * pipeline rather than reimplemented so that a place slug and a venue id transliterate
 * æ/ø/å identically.
 */

export type PlaceKey = string;

export interface PlaceSlugs {
  /** Place name (the `kommune` field) to URL slug. */
  bySted: Map<string, string>;
  /** County name to URL slug. */
  byFylke: Map<string, string>;
}

/**
 * Distinct place names can slug to the same string - and the same place name can appear in
 * two counties. Either would silently merge two unrelated places onto one page, so every
 * value gets its own slug, resolved deterministically:
 *
 *   1. plain slug of the place name
 *   2. place name + county, which reads well for the "same name, different county" case
 *   3. a numeric suffix
 *
 * Step 3 exists so a single volunteer typo upstream cannot take the daily deploy down. The
 * site is rebuilt from data nobody here controls; a slightly ugly URL is a much better
 * failure mode than a build that stops publishing, and neither of them loses a quiz.
 *
 * Input is sorted first so the result does not depend on the order of rows in the source
 * table, which reshuffles between scrapes.
 */
function buildSlugMap(values: Array<{ value: string; qualifier: string }>): Map<string, string> {
  const unique = new Map<string, string>();
  for (const { value, qualifier } of values) {
    if (!unique.has(value)) unique.set(value, qualifier);
  }

  const sorted = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const taken = new Set<string>();
  const result = new Map<string, string>();

  for (const [value, qualifier] of sorted) {
    const base = slug(value) || slug(qualifier) || "sted";

    let chosen = base;
    if (taken.has(chosen)) {
      chosen = slug(`${value}-${qualifier}`) || `${base}-2`;
    }
    for (let counter = 2; taken.has(chosen); counter += 1) {
      chosen = `${base}-${counter}`;
    }

    taken.add(chosen);
    result.set(value, chosen);
  }

  return result;
}

export function buildPlaceSlugs(venues: Venue[]): PlaceSlugs {
  return {
    bySted: buildSlugMap(venues.map((v) => ({ value: v.kommune, qualifier: v.fylke }))),
    // A county name has nothing broader to qualify it with, so it qualifies itself; in
    // practice the 20 county names never collide.
    byFylke: buildSlugMap(venues.map((v) => ({ value: v.fylke, qualifier: v.fylke }))),
  };
}

/** Inverts a slug map so a page can go from URL segment back to the source spelling. */
export function invert(map: Map<string, string>): Map<string, string> {
  return new Map([...map].map(([value, slugged]) => [slugged, value]));
}
