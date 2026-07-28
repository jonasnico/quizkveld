import { describe, expect, it } from "vitest";

import { asset, href } from "../url.js";

/**
 * Under vitest `import.meta.env.BASE_URL` is "/", so these assert the shape of the output
 * rather than the production prefix. The production prefix itself is checked against the
 * built HTML by scripts/check-base.mjs, which is the only place it can be verified honestly.
 */

describe("href", () => {
  it("builds a rooted path with a trailing slash", () => {
    expect(href("sted", "tromsoe")).toBe("/sted/tromsoe/");
  });

  it("returns the base itself for no segments", () => {
    expect(href()).toBe("/");
  });

  it("normalises stray slashes and empty segments", () => {
    expect(href("/sted/", "", "tromsoe")).toBe("/sted/tromsoe/");
    expect(href("pub//alfa")).toBe("/pub/alfa/");
  });

  it("never emits a double slash, which is what breaks a based deploy", () => {
    expect(href("om")).not.toMatch(/\/\//);
  });
});

describe("asset", () => {
  it("does not add a trailing slash to files", () => {
    expect(asset("favicon.svg")).toBe("/favicon.svg");
    expect(asset("/favicon.svg")).toBe("/favicon.svg");
  });
});
