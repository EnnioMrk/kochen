import { describe, expect, it } from "vitest";
import { assetsInHtml, isStale } from "./version";

const running = ["/assets/index-AAA.js", "/assets/index-BBB.css"];

describe("assetsInHtml", () => {
  it("reads only client scripts and styles", () => {
    const html = `
      <link rel="preload" href="/fonts/inter-latin.woff2" />
      <link rel="stylesheet" href="/assets/index-BBB.css" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <script type="module" src="/assets/index-AAA.js"></script>
    `;
    expect(assetsInHtml(html)).toEqual(running);
  });
});

describe("isStale", () => {
  it("is false while the names match", () => {
    expect(isStale(running, [...running].reverse())).toBe(false);
  });

  it("is true when the script hash changed", () => {
    expect(isStale(running, ["/assets/index-CCC.js", "/assets/index-BBB.css"])).toBe(true);
  });

  it("is true when a style file was added", () => {
    expect(isStale(running, [...running, "/assets/extra-DDD.css"])).toBe(true);
  });

  it("is false when the live answer is missing", () => {
    expect(isStale(running, null)).toBe(false);
  });

  it("is false in local development", () => {
    expect(isStale([], ["/assets/index-AAA.js"])).toBe(false);
  });
});
