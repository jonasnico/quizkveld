/**
 * Venue name matching.
 *
 * Only 3 of 322 venues carry an address, so almost everything rests on matching informal
 * names - «Hullet i veggen», "Hvaskjer, Torshov", "Fru Burums" - against OpenStreetMap.
 * That is inherently risky, so this module is deliberately strict: a wrong coordinate
 * renders as a confident pin that a user cannot tell is wrong, and no coordinate is always
 * the better outcome.
 */

export type MatchKind = "exact" | "fuzzy";

export interface MatchScore {
  kind: MatchKind;
  /** 0-1. Only used to rank candidates against each other. */
  score: number;
}

/**
 * Words that say what kind of place it is rather than which place it is. Dropping them
 * lets "Bølgen Kro" match "Bølgen" but keeps "Kroa" (which is a name) intact, because the
 * removal is token-wise and never applied to the only remaining token.
 */
const GENERIC_TOKENS = new Set([
  "pub",
  "pubb",
  "bar",
  "kro",
  "kroa",
  "cafe",
  "kafe",
  "kaffebar",
  "restaurant",
  "restaurang",
  "bistro",
  "gastropub",
  "sportsbar",
  "nattklubb",
  "klubb",
  "club",
  "the",
  "og",
  "and",
  "as",
  "asa",
  "ba",
  "da",
]);

/** Strips the decorations Norwegian venue listings pick up: quotes, dashes, suffixes. */
export function normalizeVenueName(name: string): string {
  return name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[«»"'`´’‘“”]/g, " ")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(name: string): string[] {
  const tokens = normalizeVenueName(name).split(" ").filter(Boolean);
  const meaningful = tokens.filter((token) => !GENERIC_TOKENS.has(token));
  return meaningful.length > 0 ? meaningful : tokens;
}

/** Levenshtein distance, iterative with a single row. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/** Fuzzy matches below this are discarded outright. */
export const MIN_FUZZY_SCORE = 0.86;

/**
 * Scores a candidate name against the venue name, or returns null when the pair is not
 * close enough to be worth a coordinate.
 */
export function scoreName(venueName: string, candidateName: string): MatchScore | null {
  const venueTokens = tokenize(venueName);
  const candidateTokens = tokenize(candidateName);
  if (venueTokens.length === 0 || candidateTokens.length === 0) return null;

  const venueKey = venueTokens.join(" ");
  const candidateKey = candidateTokens.join(" ");
  if (venueKey === candidateKey) return { kind: "exact", score: 1 };

  // Full-string equality before generic words were dropped also counts as exact.
  if (normalizeVenueName(venueName) === normalizeVenueName(candidateName)) {
    return { kind: "exact", score: 1 };
  }

  // A short name fully contained in a longer one ("Skatten" in "Skatten Pub & Bar") is a
  // strong signal, but only when the shorter side is distinctive enough to mean something.
  const venueSet = new Set(venueTokens);
  const candidateSet = new Set(candidateTokens);
  const shared = [...venueSet].filter((token) => candidateSet.has(token));
  const smaller = Math.min(venueSet.size, candidateSet.size);
  if (shared.length === smaller && smaller > 0) {
    const sharedLength = shared.join("").length;
    if (sharedLength >= 5) {
      const union = new Set([...venueSet, ...candidateSet]).size;
      return { kind: "fuzzy", score: 0.9 + 0.09 * (shared.length / union) };
    }
  }

  const ratio = similarity(venueKey, candidateKey);
  if (ratio >= MIN_FUZZY_SCORE) return { kind: "fuzzy", score: ratio };

  return null;
}

export interface Candidate {
  name: string;
  lat: number;
  lon: number;
  /** Free-form provenance, used only for the run report. */
  detail?: string;
}

export interface ScoredCandidate<T extends Candidate = Candidate> {
  candidate: T;
  match: MatchScore;
}

/** How far apart two equally good candidates may be before the match is called ambiguous. */
export const AMBIGUITY_DISTANCE_METERS = 400;

export interface PickOptions {
  /** Injected so this module stays free of geometry imports in tests. */
  distanceMeters: (a: Candidate, b: Candidate) => number;
  ambiguityDistanceMeters?: number;
}

/**
 * Picks the single best candidate, or nothing.
 *
 * Two candidates that score the same and sit far apart mean the name is not distinctive
 * here - two different pubs called Samfundet in the same kommune, say - and guessing
 * between them is exactly the failure mode this whole step exists to avoid.
 */
export function pickBest<T extends Candidate>(
  scored: Array<ScoredCandidate<T>>,
  options: PickOptions,
): ScoredCandidate<T> | null {
  if (scored.length === 0) return null;

  const ranked = [...scored].sort((a, b) => b.match.score - a.match.score);
  const best = ranked[0];
  if (!best) return null;

  const limit = options.ambiguityDistanceMeters ?? AMBIGUITY_DISTANCE_METERS;
  const rivals = ranked
    .slice(1)
    .filter((entry) => best.match.score - entry.match.score < 0.02);

  for (const rival of rivals) {
    if (options.distanceMeters(best.candidate, rival.candidate) > limit) return null;
  }

  return best;
}
