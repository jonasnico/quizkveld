import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_HTML = path.join(here, "fixtures", "sample.html");

export function loadFixture(): Promise<string> {
  return fs.readFile(FIXTURE_HTML, "utf8");
}

/** Pinned so `lastSeen` and `generatedAt` are stable in snapshots. */
export const FIXED_NOW = new Date("2026-07-28T04:00:00.000Z");
