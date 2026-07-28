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
 *    Fjordane) plus Svalbard. We navigate on `fylkeNow` instead - see `fylkeOf`.
 *
 * Slugs must be stable, because they are the site's URLs. `slug()` is imported from the
 * pipeline rather than reimplemented so that a place slug and a venue id transliterate
 * æ/ø/å identically.
 */

export type PlaceKey = string;

/**
 * The county a venue is filed under.
 *
 * The source's `fylke` is pre-2020: it still says Hordaland, Sør-Trøndelag, Hedmark,
 * Vest-Agder, Aust-Agder, Oppland, Nord-Trøndelag and Sogn og Fjordane. All eight were
 * dissolved in the 2020 reform, and they cover 78 of 322 venues. Navigating on them means
 * someone looking for a quiz in Bergen has to know to press "Hordaland", while "Vestland"
 * does not exist on the site at all.
 *
 * `fylkeNow` is a per-venue lookup against Kartverket, not a rename table, which is why we
 * can trust it: Jevnaker went Oppland -> Viken -> Akershus, and no hand-written alias list
 * would send it anywhere but Innlandet with the rest of Oppland.
 *
 * The source's own spelling is kept in `fylke` and still used where we are talking *to* the
 * source - the correction mailto quotes their wording so a volunteer can find the row.
 *
 * One venue (Sandnesseter) has no `fylkeNow` because Kartverket does not know the place, so
 * it falls back to the source rather than dropping out of the navigation. Svalbard needs no
 * special case: it kept its name, so old and new are the same string.
 */
export function fylkeOf(venue: Pick<Venue, "fylke" | "fylkeNow">): string {
  return venue.fylkeNow ?? venue.fylke;
}

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
    bySted: buildSlugMap(venues.map((v) => ({ value: v.kommune, qualifier: fylkeOf(v) }))),
    // A county name has nothing broader to qualify it with, so it qualifies itself; in
    // practice the county names never collide.
    byFylke: buildSlugMap(venues.map((v) => ({ value: fylkeOf(v), qualifier: fylkeOf(v) }))),
  };
}

/**
 * Slugs the site used to publish for counties that no longer exist, mapped to where that
 * content lives now.
 *
 * Derived from the data rather than written down: for every venue whose `fylke` slugs
 * differently from its `fylkeOf`, the old slug points at the new one. If the source renames
 * something again, or if a county we redirect away from comes back, this follows along
 * without anyone editing a table - the same reason we trust `fylkeNow` in the first place.
 *
 * A legacy name that is still a current county (Akershus, Svalbard, Oslo) is never a
 * redirect, or it would shadow the real page.
 *
 * One old county can split across two new ones: Oppland went mostly to Innlandet, but
 * Jevnaker went Oppland -> Viken -> Akershus. A URL can only point one way, so it points
 * where most of the content went, ties broken alphabetically. Choosing by count rather than
 * by whichever row happened to come last keeps the URL stable across scrapes, which is the
 * same reason `buildSlugMap` sorts its input.
 */
export function legacyFylkeSlugs(venues: Venue[]): Map<string, string> {
  const current = buildPlaceSlugs(venues).byFylke;
  const live = new Set(current.values());

  const tally = new Map<string, Map<string, number>>();
  for (const venue of venues) {
    const from = slug(venue.fylke);
    const to = current.get(fylkeOf(venue));
    if (!from || !to || from === to || live.has(from)) continue;

    const targets = tally.get(from) ?? new Map<string, number>();
    targets.set(to, (targets.get(to) ?? 0) + 1);
    tally.set(from, targets);
  }

  const chosen = [...tally].map(([from, targets]) => {
    const best = [...targets].sort(([aTo, aN], [bTo, bN]) => bN - aN || (aTo < bTo ? -1 : 1));
    return [from, best[0]![0]] as const;
  });

  return new Map(chosen.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Inverts a slug map so a page can go from URL segment back to the source spelling. */
export function invert(map: Map<string, string>): Map<string, string> {
  return new Map([...map].map(([value, slugged]) => [slugged, value]));
}
