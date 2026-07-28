import type { CategoryNorm } from "./schema.js";

/**
 * Category normalization.
 *
 * The category column is genuinely free text: alongside "Allmenn", "Musikk" and "Sport"
 * it holds things like "Popkultur", "Allmenn/Musikk", "IconaPopQuiz" and
 * "«Fakta om makta» - Samfunn og politikk". We map to a small closed set for filtering
 * and always keep the original for display.
 */

/**
 * Ordered rules - the first match wins. Order matters for mixed values: "Allmenn/Musikk"
 * is primarily a general quiz, so `allmenn` is checked before `musikk`.
 */
const RULES: Array<{ norm: CategoryNorm; re: RegExp }> = [
  { norm: "allmenn", re: /\ballmenn\w*\b|\bgenerell\b|\bblandet\b|\bvariert\b/ },
  { norm: "sport", re: /\bsport\w*\b|\bfotball\w*\b|\bidrett\w*\b/ },
  { norm: "film", re: /\bfilm\w*\b|\bkino\b|\btv-?serie\w*\b|\bserier\b/ },
  {
    norm: "musikk",
    re: /\bmusikk\w*\b|\brock\w*\b|\bpop\b|\bpopkultur\b|\bmusikkbingo\b|\bhiphop\b|\bjazz\b|\blyd\b/,
  },
];

export function normalizeCategory(raw: string): CategoryNorm {
  const text = raw
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[«»"'”“]/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "annet";

  for (const { norm, re } of RULES) {
    if (re.test(text)) return norm;
  }

  return "annet";
}

/** Collapses whitespace in the original category text without changing its meaning. */
export function cleanCategory(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\s*\n\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}
