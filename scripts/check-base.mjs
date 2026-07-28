import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

/**
 * Fails the build when an internal link forgets the base path.
 *
 * The site is served from `/quizkveld/` on GitHub Pages. A link written as `/om/` instead
 * of `href("om")` works perfectly in `astro dev` and 404s in production, which is the
 * single most common way a project-Pages deploy breaks. Rather than rely on remembering,
 * we grep the built output.
 *
 * When BASE becomes "/" for a custom domain this check turns into a no-op on its own.
 */

const DIST = path.resolve(import.meta.dirname, "..", "dist");

// Import the config rather than parsing it: the file also documents the custom-domain
// values in a comment, and a regex happily matches those instead of the real ones.
const { default: config } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, "..", "astro.config.mjs")).href
);
const base = config.base ?? "/";

const normalisedBase = base.endsWith("/") ? base : `${base}/`;

if (normalisedBase === "/") {
  console.log("check-base: base er «/», ingenting å sjekke.");
  process.exit(0);
}

/** Matches root-relative href/src values, which is the only shape that can be wrong. */
const ATTRIBUTE_RE = /(?:href|src|srcset|action)="(\/[^"]*)"/g;

// Astro emits these itself and they are correct by construction.
const ALLOWED_EXACT = new Set(["/"]);

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* htmlFiles(full);
    } else if (entry.name.endsWith(".html")) {
      yield full;
    }
  }
}

const problems = [];

for await (const file of htmlFiles(DIST)) {
  const html = await readFile(file, "utf8");
  for (const match of html.matchAll(ATTRIBUTE_RE)) {
    const value = match[1];
    if (value.startsWith("//")) continue; // protocol-relative, external
    if (ALLOWED_EXACT.has(value)) continue;
    if (value.startsWith(normalisedBase)) continue;
    problems.push(`${path.relative(DIST, file)}: ${match[0]}`);
  }
}

if (problems.length > 0) {
  console.error(
    `check-base: ${problems.length} intern(e) lenke(r) mangler base-stien «${normalisedBase}».\n` +
      "Bruk href() fra src/lib/url.ts i stedet for å skrive stien direkte.\n",
  );
  for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
  if (problems.length > 20) console.error(`  … og ${problems.length - 20} til`);
  process.exit(1);
}

console.log(`check-base: alle interne lenker respekterer «${normalisedBase}».`);
