/**
 * Venue name cleaning and address extraction.
 *
 * Venue names in the source are hand-typed by volunteers and frequently carry an address
 * along for the ride, either on a second line or inside parentheses:
 *
 *   «Hullet i veggen»\n(Café Marienlyst, Kirkeveien 104)
 *   Bølgen Kro (Mikrobølgen 29, Munkelia)
 *
 * We pull the address out into `addressHint` so the geocoding step has something precise
 * to work with, while keeping the name itself readable.
 */

/** Street-name endings that make a Norwegian address unmistakable. */
const STREET_SUFFIX =
  "(?:vei|veien|vn|gate|gaten|gata|gt|plass|plassen|alle|allé|alléen|alleen|torg|torget|brygge|brygga|kai|kaia|plassen|stredet|bakken|svingen|løkka|lokka)";

/** A capitalised token (Norwegian letters allowed) followed by a house number. */
const ADDRESS_RE = new RegExp(
  String.raw`\b([A-ZÆØÅ][\wÆØÅæøå'\-]*${STREET_SUFFIX}|[A-ZÆØÅ][\wÆØÅæøå'\-]+)\s+(\d{1,4}\s*[A-Za-z]?)\b`,
);

/** Same, but only accepting names with an explicit street suffix (stricter). */
const STRICT_ADDRESS_RE = new RegExp(
  String.raw`\b([A-ZÆØÅ][\wÆØÅæøå'\-]*${STREET_SUFFIX})\s+(\d{1,4}\s*[A-Za-z]?)\b`,
);

export interface CleanedVenue {
  name: string;
  addressHint?: string;
}

function collapse(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits a venue string into a leading name part and any trailing qualifier, which may be
 * a parenthesised group or whatever followed a line break.
 */
function splitQualifier(raw: string): { head: string; tail: string | null } {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 1) {
    const head = lines[0] ?? "";
    const tail = lines.slice(1).join(", ");
    return { head, tail };
  }

  const single = lines[0] ?? "";
  const parenthesised = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(single);
  if (parenthesised) {
    const head = (parenthesised[1] ?? "").trim();
    const tail = (parenthesised[2] ?? "").trim();
    if (head) return { head, tail };
  }

  return { head: single, tail: null };
}

/** Strips a leading/trailing parenthesis pair, if the segment is fully wrapped in one. */
function unwrapParens(text: string): string {
  const wrapped = /^\((.*)\)$/.exec(text.trim());
  return (wrapped?.[1] ?? text).trim();
}

/** Trims punctuation and stray brackets left over by unbalanced parentheses in the source. */
function tidyAddress(text: string): string {
  return collapse(text)
    .replace(/^[\s,;:.)\]»]+/, "")
    .replace(/[\s,;:.(\[«]+$/, "")
    .replace(/\)+$/, "")
    .trim();
}

export function cleanVenue(raw: string): CleanedVenue {
  const { head, tail } = splitQualifier(raw);

  if (tail !== null) {
    const candidate = collapse(unwrapParens(tail));
    // Some entries are genuinely malformed, e.g.
    // "Café Marienlyst\n(«Hullet i veggen»), Kirkeveien 104)". Slicing from the address
    // match onwards keeps the hint clean instead of dragging the noise along.
    const match = STRICT_ADDRESS_RE.exec(candidate) ?? ADDRESS_RE.exec(candidate);
    if (match) {
      const addressHint = tidyAddress(candidate.slice(match.index));
      const name = collapse(head) || collapse(raw);
      if (addressHint) return { name, addressHint };
    }
    // Not an address - it is a qualifier that belongs to the name,
    // e.g. "Kjøkkenet (Rockefeller)".
    const rejoined = raw.includes("\n")
      ? collapse(raw.replace(/\n/g, " "))
      : collapse(raw);
    return { name: rejoined };
  }

  const name = collapse(head) || collapse(raw);

  // No qualifier, but the name itself may end in a bare street address,
  // e.g. "Pokalen Parkveien 3".
  const strict = STRICT_ADDRESS_RE.exec(name);
  if (strict && strict.index > 0) {
    const before = name.slice(0, strict.index).trim().replace(/[,\-–]\s*$/, "");
    const addressHint = tidyAddress(strict[0]);
    if (before.length > 1 && addressHint) {
      return { name: before, addressHint };
    }
  }

  return { name };
}
