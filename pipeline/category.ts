import { CATEGORY_NORMS, type CategoryNorm } from "./schema.js";

/**
 * Category normalization.
 *
 * The category column is genuinely free text: alongside "Allmenn", "Musikk" and "Sport"
 * it holds things like "Popkultur", "Allmenn/Musikk", "IconaPopQuiz" and
 * "«Fakta om makta» - Samfunn og politikk". We map to a small closed set for filtering
 * and always keep the original for display.
 *
 * A row can legitimately name several genres ("Allmenn/film/musikk"), so this returns
 * every genre it recognises rather than just the first. Collapsing to one loses real
 * data: 27 rows name more than one genre, and a music filter reading a single value
 * would hide roughly ten quizzes that genuinely are music quizzes.
 */

const RULES: Array<{ norm: CategoryNorm; re: RegExp }> = [
  { norm: "allmenn", re: /\ballmenn\w*\b|\bgenerell\b|\bblandet\b|\bvariert\b/ },
  { norm: "sport", re: /\bsport\w*\b|\bfotball\w*\b|\bidrett\w*\b/ },
  // "serier" and "tv-serie" mean film/TV, but "seriespill" is a league format for
  // general quizzes and must not be pulled in here.
  { norm: "film", re: /\bfilm\w*\b|\bkino\b|\btv-?serie\w*\b|\bserier\b/ },
  {
    norm: "musikk",
    re: /\bmusikk\w*\b|\brock\w*\b|\bpop\b|\bpopkultur\b|\bmusikkbingo\b|\bhiphop\b|\bjazz\b|\blyd\b/,
  },
];

/** Rank used for output ordering, so the array is deterministic regardless of the text. */
const RANK = new Map<CategoryNorm, number>(CATEGORY_NORMS.map((norm, i) => [norm, i]));

function tidy(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[«»"'”“]/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns every genre named in the text, deduplicated and in a stable order.
 *
 * Matching runs over the whole string rather than over separator-split segments. The
 * separators are not reliable: "Allmenn - med påfølgende musikkquiz" and "Annenhver
 * allmennquiz og musikkbingo" both name two genres without a consistent delimiter, so
 * splitting first would drop the second genre. Matching the whole string catches every
 * case splitting would, plus these.
 *
 * Never returns an empty array - falls back to ["annet"].
 */
export function normalizeCategories(raw: string): [CategoryNorm, ...CategoryNorm[]] {
  const text = tidy(raw);
  if (!text) return ["annet"];

  const found = RULES.filter(({ re }) => re.test(text)).map(({ norm }) => norm);
  if (found.length === 0) return ["annet"];

  const unique = [...new Set(found)].sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0));
  return unique as [CategoryNorm, ...CategoryNorm[]];
}

/**
 * The single most general genre of a row, used only as a tie-breaker when two quizzes
 * would otherwise share an id. Kept separate from the array so that adding a genre to a
 * row can never renumber an existing id.
 */
export function primaryCategory(raw: string): CategoryNorm {
  return normalizeCategories(raw)[0];
}

/** Collapses whitespace in the original category text without changing its meaning. */
export function cleanCategory(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\s*\n\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}
