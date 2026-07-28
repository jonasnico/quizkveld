import { getCollection } from "astro:content";

import type { Quiz, Venue } from "../../pipeline/schema.js";
import { joinQuizzes, sortQuizzes, type QuizAtVenue } from "./model.js";
import { buildPlaceSlugs, type PlaceSlugs } from "./place.js";

/**
 * The single place the site reads data from.
 *
 * Entries come out of the Content Layer already validated against the pipeline's Zod
 * schemas (see src/content.config.ts), so the casts here restore the TypeScript types that
 * validation guarantees rather than asserting anything new.
 */

export interface SiteData {
  items: QuizAtVenue[];
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

  // Soft-deleted rows are kept in the dataset so ids stay stable, but they describe
  // quizzes the source has stopped listing. Showing them would send people out on the
  // word of a listing that no longer exists.
  const venues = venueEntries.map((entry) => entry.data as unknown as Venue).filter((v) => !v.stale);
  const quizzes = quizEntries.map((entry) => entry.data as unknown as Quiz).filter((q) => !q.stale);

  const { items, orphans } = joinQuizzes(quizzes, venues);
  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} quiz(er) peker på et sted som ikke finnes: ${orphans.slice(0, 5).join(", ")}`,
    );
  }

  const meta = metaEntries[0]?.data as unknown as
    | { generatedAt: string; sourceUpdatedAt: string | null }
    | undefined;
  if (!meta) {
    throw new Error("data/quizzes.json mangler metadata (generatedAt / sourceUpdatedAt)");
  }

  cached = {
    items: sortQuizzes(items),
    venues,
    quizzes,
    slugs: buildPlaceSlugs(venues),
    meta,
  };

  return cached;
}
