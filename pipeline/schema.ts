import { z } from "zod";

/**
 * Shared data model for quizkveld.
 *
 * These schemas are the contract between the data pipeline and the (future) Astro site,
 * which will reuse them through the Content Layer. Keep them dependency-free.
 */

export const GEO_SOURCES = ["address", "osm", "kartverket", "centroid", "manual"] as const;
export const GeoSourceSchema = z.enum(GEO_SOURCES);
export type GeoSource = z.infer<typeof GeoSourceSchema>;

export const GEO_CONFIDENCES = ["high", "medium", "low"] as const;
export const GeoConfidenceSchema = z.enum(GEO_CONFIDENCES);
export type GeoConfidence = z.infer<typeof GeoConfidenceSchema>;

export const RECURRENCE_KINDS = [
  "weekly",
  "biweekly",
  "monthly-nth",
  "last-of-month",
  "irregular",
] as const;
export const RecurrenceKindSchema = z.enum(RECURRENCE_KINDS);
export type RecurrenceKind = z.infer<typeof RecurrenceKindSchema>;

export const CATEGORY_NORMS = ["allmenn", "musikk", "sport", "film", "annet"] as const;
export const CategoryNormSchema = z.enum(CATEGORY_NORMS);
export type CategoryNorm = z.infer<typeof CategoryNormSchema>;

export const WEEKDAYS = [
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lordag",
  "sondag",
] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const RecurrenceSchema = z.object({
  kind: RecurrenceKindSchema,
  /** RFC 5545 RRULE string. Absent for `irregular`. */
  rrule: z.string().optional(),
  /** The original Norwegian text from the source, always preserved verbatim. */
  raw: z.string(),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const VenueSchema = z.object({
  id: z.string().min(1),
  /** Cleaned, display-ready venue name. */
  name: z.string().min(1),
  /** Untouched venue text as scraped, newlines and all. */
  rawName: z.string(),
  /** Street address pulled out of the venue name, when one was embedded there. */
  addressHint: z.string().optional(),
  /**
   * The city/place column from the source. Note: this is *not* strictly a kommune -
   * e.g. "Greaaker" is a place within Sarpsborg kommune. Real kommune resolution
   * arrives with the geocoding step.
   */
  kommune: z.string().min(1),
  fylke: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  geoSource: GeoSourceSchema.optional(),
  geoConfidence: GeoConfidenceSchema.optional(),
  url: z.string().optional(),
  /** True when the venue was absent from the most recent scrape (soft delete). */
  stale: z.boolean().optional(),
});
export type Venue = z.infer<typeof VenueSchema>;

export const QuizSchema = z.object({
  id: z.string().min(1),
  venueId: z.string().min(1),
  weekday: WeekdaySchema.nullable(),
  /** Start time as HH:MM, or null when the source has "?" or nothing usable. */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  recurrence: RecurrenceSchema,
  /** Original category text from the source. */
  category: z.string(),
  /**
   * Every genre the row names, deduplicated and ordered by CATEGORY_NORMS. A row can
   * legitimately be both, e.g. "Allmenn/film/musikk", so a single value would drop data
   * a genre filter needs.
   */
  categoryNorm: CategoryNormSchema.array().nonempty(),
  note: z.string().optional(),
  /** ISO date (YYYY-MM-DD) of the last scrape that still contained this quiz. */
  lastSeen: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** True when the quiz was absent from the most recent scrape (soft delete). */
  stale: z.boolean().optional(),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const QuizDataSchema = z.object({
  generatedAt: z.string().datetime(),
  /** "Sist oppdatert" as advertised by the source page, ISO date. Null if not found. */
  sourceUpdatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  venues: z.array(VenueSchema),
  quizzes: z.array(QuizSchema),
});
export type QuizData = z.infer<typeof QuizDataSchema>;

export const GeoCacheEntrySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  geoSource: GeoSourceSchema,
  geoConfidence: GeoConfidenceSchema,
  resolvedAt: z.string().datetime(),
});
export type GeoCacheEntry = z.infer<typeof GeoCacheEntrySchema>;

/** Append-only, keyed by venue id. */
export const GeoCacheSchema = z.record(z.string(), GeoCacheEntrySchema);
export type GeoCacheData = z.infer<typeof GeoCacheSchema>;

/**
 * Hand corrections. Keyed by venue id / quiz id; every field present here wins over
 * whatever the scraper produced.
 */
export const OverridesSchema = z.object({
  venues: z.record(z.string(), VenueSchema.partial()).default({}),
  quizzes: z.record(z.string(), QuizSchema.partial()).default({}),
});
export type Overrides = z.infer<typeof OverridesSchema>;

/** A single scraped table row, before any normalization. */
export const RawRowSchema = z.object({
  fylke: z.string(),
  city: z.string(),
  venueRaw: z.string(),
  venueUrl: z.string().optional(),
  weekdayRaw: z.string(),
  timeRaw: z.string(),
  categoryRaw: z.string(),
});
export type RawRow = z.infer<typeof RawRowSchema>;

export const ParseResultSchema = z.object({
  sourceUpdatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  rows: z.array(RawRowSchema),
  /** Non-fatal oddities encountered while parsing, for the run report. */
  warnings: z.array(z.string()),
});
export type ParseResult = z.infer<typeof ParseResultSchema>;
