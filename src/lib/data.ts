import { getCollection } from "astro:content";

import type { Quiz, Venue } from "../../pipeline/schema.js";
import { joinQuizzes, partitionByFreshness, sortQuizzes, type QuizAtVenue } from "./model.js";
import { buildPlaceSlugs, type PlaceSlugs } from "./place.js";

/**
 * The single place the site reads data from.
 *
 * Entries come out of the Content Layer already validated against the pipeline's Zod
 * schemas (see src/content.config.ts), so the casts here restore the TypeScript types that
 * validation guarantees rather than asserting anything new.
 */

export interface SiteData {
  /** Fresh quizzes, the only ones that may appear in a dated view. */
  items: QuizAtVenue[];
  /**
   * Quizzes the source has stopped listing. Kept separate rather than dropped so that
   * `/pub/<id>/` and `/sted/<sted>/` keep resolving for links people have already shared.
   */
  staleItems: QuizAtVenue[];
  venues: Venue[];
  quizzes: Quiz[];
  slugs: PlaceSlugs;
  meta: { generatedAt: string; sourceUpdatedAt: string | null };
}

let cached: SiteData | null = null;

export async function loadSiteData(): Promise<SiteData> {
  if (cached) return cached;

  const [venueEntries, quizEntries, metaEntries] = await Promise.all([
    getCollection("venues"),
    getCollection("quizzes"),
    getCollection("meta"),
  ]);

  const venues = venueEntries.map((entry) => entry.data as unknown as Venue);
  const quizzes = quizEntries.map((entry) => entry.data as unknown as Quiz);

  const { items, orphans } = joinQuizzes(quizzes, venues);

  // A quiz pointing at a venue that is not in the file is broken data, but the site
  // rebuilds every day from a source nobody here controls, and `QuizDataSchema` has no
  // cross-reference check to stop it upstream. Throwing here would mean one bad row halts
  // the daily publish and the site silently serves stale data until someone notices.
  // Dropping the row loses one listing and keeps the other 351.
  if (orphans.length > 0) {
    console.warn(
      `[data] ${orphans.length} quiz(er) peker på et sted som ikke finnes og er utelatt: ${orphans.join(", ")}`,
    );
  }

  // Soft-deleted rows describe quizzes the source has stopped listing. They must never
  // reach a dated view - "i kveld" pointing at a pub that closed is the single worst thing
  // this site could do - but their pages stay up so shared links do not rot.
  const { fresh, stale } = partitionByFreshness(items);

  const meta = metaEntries[0]?.data as unknown as
    | { generatedAt: string; sourceUpdatedAt: string | null }
    | undefined;
  // Unlike a bad row, missing metadata means the file itself is not what we think it is.
  if (!meta) {
    throw new Error("data/quizzes.json mangler metadata (generatedAt / sourceUpdatedAt)");
  }

  cached = {
    items: sortQuizzes(fresh),
    staleItems: sortQuizzes(stale),
    venues,
    quizzes,
    slugs: buildPlaceSlugs(venues),
    meta,
  };

  return cached;
}
