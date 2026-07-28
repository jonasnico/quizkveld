/**
 * Deterministic slugging and stable id generation.
 *
 * Ids are the backbone of this pipeline: the geocache and the manual overrides are keyed
 * by them, so they must survive re-scrapes byte for byte. Everything here is pure and
 * has no dependency on locale or environment.
 */

const TRANSLITERATION: Record<string, string> = {
  æ: "ae",
  ø: "oe",
  å: "aa",
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  đ: "d",
  ð: "d",
  þ: "th",
};

/**
 * Lowercase, transliterate Norwegian characters, strip remaining diacritics and reduce
 * everything else to `a-z0-9-`.
 */
export function slug(input: string): string {
  const lowered = input.toLowerCase();

  let transliterated = "";
  for (const char of lowered) {
    transliterated += TRANSLITERATION[char] ?? char;
  }

  return transliterated
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** Placeholder used in ids when the source gives us no usable start time. */
export const NO_TIME_TOKEN = "natid";

/** Placeholder used in ids when no single weekday could be determined. */
export const NO_WEEKDAY_TOKEN = "ukjent";

export function venueId(kommune: string, venueName: string): string {
  const base = slug(`${kommune}-${venueName}`);
  return base || "ukjent-sted";
}

/**
 * Ids deliberately use the *normalized* weekday rather than the raw recurrence text.
 * The raw text carries volatile detail - "Onsdager (annenhver - hoestsesong 2024 fra 28/8
 * til 4/12)" - and folding that into the id would silently break every override and
 * geocache entry the moment the source edits a season.
 */
export function quizId(
  kommune: string,
  venueName: string,
  weekday: string | null,
  time: string | null,
): string {
  const parts = [kommune, venueName, weekday ?? NO_WEEKDAY_TOKEN, time ?? NO_TIME_TOKEN];
  const base = slug(parts.join("-"));
  return base || "ukjent-quiz";
}

/**
 * Resolves id collisions deterministically.
 *
 * Two quizzes really can share a kommune, venue, weekday and time - a pub that runs both
 * a weekly Friday quiz and a separate last-Friday-of-the-month one, for instance. We
 * first try to disambiguate with a meaningful hint (the recurrence kind), because that is
 * independent of row order and therefore survives the source reshuffling its table. Only
 * if that still collides do we fall back to a positional counter.
 */
export function makeUnique(id: string, taken: Set<string>, hints: string[] = []): string {
  if (!taken.has(id)) {
    taken.add(id);
    return id;
  }

  for (const hint of hints) {
    const hinted = `${id}-${slug(hint)}`;
    if (hinted !== id && !taken.has(hinted)) {
      taken.add(hinted);
      return hinted;
    }
  }

  let counter = 2;
  while (taken.has(`${id}-${counter}`)) {
    counter += 1;
  }
  const unique = `${id}-${counter}`;
  taken.add(unique);
  return unique;
}
