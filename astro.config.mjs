// @ts-check
import { defineConfig } from "astro/config";

/**
 * Deployment target, kept as two separate values on purpose.
 *
 * Today the site lives on GitHub Pages under a project path, so it needs a base.
 * Moving to the custom domain later is a one-line change here (BASE -> "/") plus a
 * `public/CNAME` file containing `quizkveld.no`:
 *
 *   const SITE = "https://quizkveld.no";
 *   const BASE = "/";
 *
 * Nothing else in the codebase hardcodes either value: every internal link goes through
 * `href()` in src/lib/url.ts, and `scripts/check-base.mjs` fails the build if one slips
 * through. That check exists because a stray root-relative link is the classic way a
 * project-Pages site breaks.
 */
const SITE = "https://verdensherredomme.github.io";
const BASE = "/quizkveld";

export default defineConfig({
  site: SITE,
  base: BASE,
  // Astro 7 defaults to `'jsx'`, which applies JSX whitespace rules and drops the newline
  // between a word and a following inline element - "kommer fra\n<a>deres oversikt</a>"
  // renders as "kommer fradere oversikt". `true` is the HTML-aware compressor.
  compressHTML: true,
  trailingSlash: "always",
  build: {
    format: "directory",
  },
  devToolbar: {
    enabled: false,
  },
});
