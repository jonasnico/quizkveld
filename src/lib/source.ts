/**
 * Attribution constants.
 *
 * `SOURCE_URL` is re-exported from the pipeline rather than retyped, so the page the site
 * credits can never drift from the page the scraper actually reads.
 */
export { SOURCE_URL } from "../../pipeline/paths.js";

export const SOURCE_NAME = "Norges Quizforbund";

export const REPO_URL = "https://github.com/verdensherredomme/quizkveld";

/** The address the source page itself asks people to send corrections to. */
export const SOURCE_EMAIL = "admin@norgesquizforbund.no";

/**
 * Builds a `mailto:` link that reports a mistake straight to the source.
 *
 * This site is a view of someone else's list, never a source of its own. Corrections
 * therefore have to reach the people who maintain that list, not us: a suggestion box here
 * would look like it shared the work while actually creating moderation, spam and
 * conflicting reports that nobody has authority to settle. Prefilling the subject means the
 * volunteer on the other end gets a usable report instead of "hi, one of your quizzes is
 * wrong".
 */
export function reportUrl(subject: string, body?: string): string {
  const params = new URLSearchParams({ subject });
  if (body) params.set("body", body);
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  return `mailto:${SOURCE_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}
