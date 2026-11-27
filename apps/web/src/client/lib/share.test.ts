import { describe, expect, it } from "vitest";
import { sharedLink } from "./share";

describe("sharedLink", () => {
  it("takes the shared url as it is", () => {
    expect(sharedLink({ url: "https://www.instagram.com/reel/abc" })).toBe(
      "https://www.instagram.com/reel/abc",
    );
  });

  it("adds a scheme to a bare shared url", () => {
    expect(sharedLink({ url: "instagram.com/reel/abc" })).toBe("https://instagram.com/reel/abc");
  });

  it("reads a link out of the shared text", () => {
    expect(sharedLink({ text: "Schau mal: https://x.com/a)." })).toBe("https://x.com/a");
  });

  it("reads a bare host out of the shared text", () => {
    expect(sharedLink({ text: "Das Rezept: instagram.com/reel/abc" })).toBe(
      "https://instagram.com/reel/abc",
    );
  });

  it("falls back to the shared title", () => {
    expect(sharedLink({ title: "https://youtube.com/watch?v=1" })).toBe(
      "https://youtube.com/watch?v=1",
    );
  });

  it("rejects a payload without a link", () => {
    expect(sharedLink({ text: "Ein Rezept für 2.0 Personen", title: "Kuchen" })).toBeNull();
  });

  it("rejects a scheme that is not http", () => {
    expect(sharedLink({ url: "ftp://example.com/a" })).toBeNull();
    expect(sharedLink({ text: "javascript:alert(1)" })).toBeNull();
  });

  it("prefers the url field", () => {
    expect(sharedLink({ url: "https://a.example/x", text: "https://b.example/y" })).toBe(
      "https://a.example/x",
    );
  });
});
