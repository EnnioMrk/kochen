import { describe, expect, it } from "vitest";
import { reasonFrom } from "./platform-test";

/** The real strings yt-dlp sent, with the tool wrapper around them. */
const YOUTUBE_GONE =
  "tool_failed:yt-dlp:ERROR: [youtube] BaW_jenozKc: This video is unavailable";
const YOUTUBE_BOT =
  "tool_failed:yt-dlp:ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.";
const TIKTOK_ODD =
  "tool_failed:yt-dlp:ERROR: [TikTok] 7704834703446117662: Unexpected response from webpage request; please report this issue on https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate";
const INSTAGRAM_LOGIN =
  "tool_failed:yt-dlp:ERROR: [Instagram] instagram: Requested content is not available, rate-limit reached or login required.";

describe("platform login test reasons", () => {
  it("keeps the tool wrapper out of the sentence", () => {
    for (const raw of [YOUTUBE_GONE, YOUTUBE_BOT, TIKTOK_ODD, INSTAGRAM_LOGIN]) {
      const message = reasonFrom(raw, false);
      expect(message.toLowerCase()).not.toContain("tool_failed");
      expect(message.toLowerCase()).not.toContain("error:");
      expect(message.length).toBeLessThan(320);
    }
  });

  it("names a gone test video as such", () => {
    expect(reasonFrom(YOUTUBE_GONE, false)).toContain("Testvideo");
  });

  it("asks for cookies when a login wall appears", () => {
    expect(reasonFrom(YOUTUBE_BOT, false)).toContain("Cookies");
    expect(reasonFrom(YOUTUBE_BOT, true)).toContain("abgelaufen");
  });

  it("turns a refused transfer into a cookie hint", () => {
    expect(reasonFrom(TIKTOK_ODD, false)).toContain("Cookies");
    expect(reasonFrom(INSTAGRAM_LOGIN, true)).toContain("abgelaufen");
  });

  it("names throttling", () => {
    expect(reasonFrom("ERROR: HTTP Error 429: Too Many Requests", true)).toContain("drosselt");
  });
});
