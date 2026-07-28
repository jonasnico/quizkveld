/**
 * Base-aware URL building.
 *
 * The site is served from `/quizkveld/` on GitHub Pages but will move to the root of
 * `quizkveld.no` later. Every internal link therefore goes through `href()` instead of
 * being written root-relative, and `scripts/check-base.mjs` fails the build if one is
 * missed. Forgetting the base is the classic way a project-Pages site ships with every
 * link and stylesheet 404ing.
 */

const BASE = import.meta.env.BASE_URL;

/**
 * Builds an internal URL from path segments.
 *
 * `href("sted", "tromsoe")` -> `/quizkveld/sted/tromsoe/`
 * `href()`                  -> `/quizkveld/`
 *
 * Segments are joined and normalised, and a trailing slash is always added to match the
 * `trailingSlash: "always"` setting in astro.config.mjs.
 */
export function href(...segments: string[]): string {
  const path = segments
    .flatMap((segment) => segment.split("/"))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");

  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  return path ? `${base}/${path}/` : `${base}/`;
}

/** Same as `href`, but for files in `public/` that must not gain a trailing slash. */
export function asset(path: string): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  return `${base}/${path.replace(/^\/+/, "")}`;
}
