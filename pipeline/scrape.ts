import fs from "node:fs/promises";
import path from "node:path";
import { fetch } from "undici";
import { PATHS, SOURCE_URL, USER_AGENT } from "./paths.js";

/**
 * A healthy page is well over 300 KB. Anything much smaller means we got an error page,
 * a Cloudflare interstitial or a truncated response, and we must not overwrite the last
 * known good HTML with it.
 */
const MIN_BODY_BYTES = 50_000;

export interface ScrapeResult {
  html: string;
  bytes: number;
  /** True when the newly fetched HTML differs from what was already on disk. */
  changed: boolean;
}

async function fetchOnce(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "nb-NO,nb;q=0.9,no;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(
      `Kilden svarte med HTTP ${response.status} (${url}). Avbryter uten a skrive raw/latest.html.`,
    );
  }

  return await response.text();
}

/** Fetches the source page and writes it to `raw/latest.html`. */
export async function scrape(
  url: string = SOURCE_URL,
  outFile: string = PATHS.rawHtml,
): Promise<ScrapeResult> {
  let html: string;
  try {
    html = await fetchOnce(url);
  } catch (error) {
    // One polite retry. We run at most once a day, so we do not hammer the source.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    html = await fetchOnce(url);
    void error;
  }

  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes < MIN_BODY_BYTES) {
    throw new Error(
      `Nedlastet HTML er mistenkelig liten (${bytes} bytes, forventet minst ${MIN_BODY_BYTES}). ` +
        `Avbryter uten a skrive raw/latest.html.`,
    );
  }

  // Normalize line endings so the committed file diffs identically on Windows and CI.
  const normalized = html.replace(/\r\n/g, "\n");

  let previous: string | null = null;
  try {
    previous = await fs.readFile(outFile, "utf8");
  } catch {
    previous = null;
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, normalized, "utf8");

  return { html: normalized, bytes, changed: previous !== normalized };
}
