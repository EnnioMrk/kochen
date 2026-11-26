import { describe, expect, it } from "vitest";
import { sourceCacheKey } from "../src/source-cache";

describe("sourceCacheKey", () => {
  it("gives one key for tracking variants of the same reel", () => {
    const plain = sourceCacheKey("https://www.instagram.com/reel/ABC123/");
    const tracked = sourceCacheKey(
      "https://instagram.com/reel/ABC123/?igsh=MXY4Zg%3D%3D&utm_source=ig_web_copy_link&si=xyz",
    );
    expect(plain).toBe("instagram.com/reel/ABC123");
    expect(tracked).toBe(plain);
  });

  it("ignores the fragment and a trailing slash", () => {
    expect(sourceCacheKey("https://Rezept.example/Suppe/#schritte")).toBe("rezept.example/Suppe");
  });

  it("sorts the query so the share order does not matter", () => {
    const first = sourceCacheKey("https://example.com/r?b=2&a=1");
    const second = sourceCacheKey("https://example.com/r?a=1&b=2");
    expect(first).toBe("example.com/r?a=1&b=2");
    expect(second).toBe(first);
  });

  it("keeps a query that changes the page", () => {
    expect(sourceCacheKey("https://youtube.com/watch?v=abc")).toBe("youtube.com/watch?v=abc");
  });

  it("drops tracking parameters but keeps the rest", () => {
    expect(sourceCacheKey("https://example.com/r?id=7&utm_medium=mail&fbclid=1")).toBe("example.com/r?id=7");
  });

  it("rejects something that is not a public address", () => {
    expect(sourceCacheKey("")).toBeNull();
    expect(sourceCacheKey("nur text")).toBeNull();
    expect(sourceCacheKey("javascript:alert(1)")).toBeNull();
    expect(sourceCacheKey("ftp://example.com/rezept")).toBeNull();
    expect(sourceCacheKey("http://localhost/rezept")).toBeNull();
  });

  it("keeps the root path empty", () => {
    expect(sourceCacheKey("https://beispiel.de/")).toBe("beispiel.de");
  });
});
