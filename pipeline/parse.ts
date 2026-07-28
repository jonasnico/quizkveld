import fs from "node:fs/promises";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";import { PATHS } from "./paths.js";
import type { ParseResult, RawRow } from "./schema.js";

const TABLE_SELECTOR = "#pubquiz-table";
const LAST_UPDATED_RE = /Sist\s+oppdatert:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i;

/** Number of cells in a data row: spacer | city | venue | weekday | time | category. */
const DATA_ROW_CELLS = 6;

/**
 * Reads a cell's text while preserving block boundaries. `<p>` and `<br>` become
 * newlines, which is what lets us both split multi-quiz rows and detect venue names with
 * an embedded address on a second line.
 */
function cellText($: cheerio.CheerioAPI, cell: Element): string {
  void $;
  const parts: string[] = [];

  const walk = (node: AnyNode): void => {
    if (node.type === "text") {
      parts.push(node.data);
      return;
    }
    if (node.type !== "tag") return;

    const tag = node.name.toLowerCase();
    if (tag === "br") {
      parts.push("\n");
      return;
    }
    const isBlock = tag === "p" || tag === "div" || tag === "li";
    if (isBlock) parts.push("\n");
    for (const child of node.children) walk(child);
    if (isBlock) parts.push("\n");
  };

  for (const child of cell.children) walk(child);

  return parts
    .join("")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/** Splits a cell's text into its block-level segments. */
function segments(text: string): string[] {
  return text
    .split("\n")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * A single `<tr>` sometimes describes more than one quiz - typically the same venue
 * running two back-to-back quizzes with different formats, encoded as parallel `<p>`
 * blocks in the time and category cells.
 *
 * We only split when the two cells reconcile: either they have the same number of
 * segments, or one has exactly one segment which then applies to all. Anything else is
 * ambiguous, so we keep the row intact and preserve the combined text.
 */
export function splitRowVariants(
  timeRaw: string,
  categoryRaw: string,
): Array<{ timeRaw: string; categoryRaw: string }> {
  const times = segments(timeRaw);
  const categories = segments(categoryRaw);

  const count = Math.max(times.length, categories.length);
  if (count <= 1) return [{ timeRaw, categoryRaw }];

  const timesOk = times.length === count || times.length === 1;
  const categoriesOk = categories.length === count || categories.length === 1;
  if (!timesOk || !categoriesOk) return [{ timeRaw, categoryRaw }];

  const variants: Array<{ timeRaw: string; categoryRaw: string }> = [];
  for (let index = 0; index < count; index += 1) {
    variants.push({
      timeRaw: times.length === 1 ? (times[0] ?? timeRaw) : (times[index] ?? ""),
      categoryRaw:
        categories.length === 1
          ? (categories[0] ?? categoryRaw)
          : (categories[index] ?? ""),
    });
  }
  return variants;
}

export function extractSourceUpdatedAt(html: string): string | null {
  const match = LAST_UPDATED_RE.exec(html);
  if (!match) return null;
  const [, day, month, year] = match;
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseHtml(html: string): ParseResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const rows: RawRow[] = [];

  const sourceUpdatedAt = extractSourceUpdatedAt($.root().text());
  if (!sourceUpdatedAt) {
    warnings.push('Fant ikke "Sist oppdatert"-datoen pa kildesiden.');
  }

  const table = $(TABLE_SELECTOR);
  if (table.length === 0) {
    throw new Error(
      `Fant ingen tabell som matcher "${TABLE_SELECTOR}". Kilden har trolig endret struktur.`,
    );
  }

  let currentFylke = "";
  let rowIndex = 0;

  table.find("tr").each((_, trNode) => {
    rowIndex += 1;
    const cells = $(trNode).children("td, th").toArray() as Element[];
    if (cells.length === 0) return;

    // A fylke heading is a single spanning cell.
    const spanning = cells.find((cell) => {
      const colspan = Number($(cell).attr("colspan") ?? "1");
      return colspan > 1;
    });
    if (spanning && cells.length === 1) {
      const heading = cellText($, spanning).replace(/\n/g, " ").trim();
      if (heading) currentFylke = heading;
      return;
    }

    if (cells.length !== DATA_ROW_CELLS) {
      const preview = cells
        .map((cell) => cellText($, cell))
        .join(" | ")
        .slice(0, 120);
      if (preview.trim().length > 0) {
        warnings.push(
          `Rad ${rowIndex} har ${cells.length} celler (forventet ${DATA_ROW_CELLS}), hoppet over: ${preview}`,
        );
      }
      return;
    }

    // Cells: 0 spacer, 1 city, 2 venue, 3 weekday, 4 time, 5 category.
    const cityCell = cells[1];
    const venueCell = cells[2];
    const weekdayCell = cells[3];
    const timeCell = cells[4];
    const categoryCell = cells[5];
    if (!cityCell || !venueCell || !weekdayCell || !timeCell || !categoryCell) return;

    const city = cellText($, cityCell).replace(/\n/g, " ").trim();
    const venueRaw = cellText($, venueCell);
    const weekdayRaw = cellText($, weekdayCell).replace(/\n/g, " ").trim();
    const timeRaw = cellText($, timeCell);
    const categoryRaw = cellText($, categoryCell);

    if (!city && !venueRaw) return;
    if (!venueRaw) {
      warnings.push(`Rad ${rowIndex} mangler stedsnavn (${city}), hoppet over.`);
      return;
    }

    // Only the venue cell's own link is meaningful; weekday and category cells sometimes
    // link to a Facebook event, which is decoration we deliberately discard.
    const href = $(venueCell).find("a[href]").first().attr("href")?.trim();

    for (const variant of splitRowVariants(timeRaw, categoryRaw)) {
      const row: RawRow = {
        fylke: currentFylke,
        city,
        venueRaw,
        weekdayRaw,
        timeRaw: variant.timeRaw,
        categoryRaw: variant.categoryRaw,
      };
      if (href) row.venueUrl = href;
      rows.push(row);
    }
  });

  return { sourceUpdatedAt, rows, warnings };
}

export async function parse(htmlFile: string = PATHS.rawHtml): Promise<ParseResult> {
  let html: string;
  try {
    html = await fs.readFile(htmlFile, "utf8");
  } catch {
    throw new Error(
      `Fant ikke ${htmlFile}. Kjor "pnpm pipeline scrape" forst for a hente kildesiden.`,
    );
  }
  return parseHtml(html);
}
