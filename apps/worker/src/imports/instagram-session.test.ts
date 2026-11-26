import { describe, expect, it } from "vitest";
import {
  hasInstagramSession,
  instagramCookieHeader,
  mergeSession,
} from "./instagram-session";

const STORED = [
  "# Netscape HTTP Cookie File",
  ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tyoutube-secret",
  ".instagram.com\tTRUE\t/\tTRUE\t1893456000\tcsrftoken\told",
  ".instagram.com\tTRUE\t/\tTRUE\t1893456000\tmid\tabc",
].join("\n");

describe("Instagram sessions", () => {
  it("does not accept an export from a signed-out browser", () => {
    expect(hasInstagramSession(STORED)).toBe(false);
    expect(hasInstagramSession(null)).toBe(false);
  });

  it("accepts a stored session cookie", () => {
    const cookies = `${STORED}\n.instagram.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tx`;
    expect(hasInstagramSession(cookies)).toBe(true);
  });

  it("adds the session and keeps every Instagram cookie", () => {
    const session = ".instagram.com\tTRUE\t/\tTRUE\t0\tsessionid\tnew\n.instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tfresh";
    const merged = mergeSession(STORED, session);
    expect(merged).toContain("\tsessionid\tnew");
    expect(merged).toContain("\tcsrftoken\tfresh");
    expect(merged).toContain("\tmid\tabc");
    expect(merged).not.toContain("SID");
    expect(merged).not.toContain("youtube-secret");
    expect(hasInstagramSession(merged)).toBe(true);
  });

  it("sends only Instagram cookies in a header", () => {
    expect(instagramCookieHeader(STORED)).toBe("csrftoken=old; mid=abc");
  });
});
