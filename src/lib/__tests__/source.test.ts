import { describe, expect, it } from "vitest";

import { SOURCE_EMAIL, SOURCE_URL, reportUrl } from "../source.js";

describe("reportUrl", () => {
  it("points at the address the source asks for", () => {
    expect(reportUrl("Retting")).toContain(`mailto:${SOURCE_EMAIL}`);
    expect(SOURCE_EMAIL).toBe("admin@norgesquizforbund.no");
  });

  it("encodes spaces as %20 rather than +", () => {
    // URLSearchParams uses "+" for spaces, which mail clients render literally in the
    // subject line. A report titled "Retting+i+oversikten" looks like a bug to whoever
    // opens it.
    const url = reportUrl("Retting i oversikten");
    expect(url).toContain("subject=Retting%20i%20oversikten");
    expect(url).not.toContain("+");
  });

  it("prefills the venue so the volunteer gets a usable report", () => {
    const url = reportUrl("Retting: Bølgen Kro, Greåker", "Gjelder Bølgen Kro.\n");
    expect(url).toContain("subject=Retting%3A%20B%C3%B8lgen%20Kro%2C%20Gre%C3%A5ker");
    expect(url).toContain("body=");
  });

  it("leaves out the body when there is nothing to prefill", () => {
    expect(reportUrl("Retting")).not.toContain("body=");
  });

  it("credits the page the scraper actually reads", () => {
    // Re-exported from the pipeline so the two can never drift apart.
    expect(SOURCE_URL).toContain("norgesquizforbund.no");
  });
});
