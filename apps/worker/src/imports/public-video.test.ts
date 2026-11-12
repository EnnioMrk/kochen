import { describe, expect, it } from "vitest";
import { instagramCaption, metaContent } from "./public-video";

const IG_EMBED = `<html><body><div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/mikeshothoney/" data-log-event="captionProfileClick" target="_blank">mikeshothoney</a><br><br>The gameday recipe we never get tired of<br><br>Ingredients:<br><br>- 2 chicken breasts<br>- 1/2 cup flour</div></body></html>`;

describe("public video text without a login", () => {
  it("reads the caption of an Instagram embed", () => {
    const parsed = instagramCaption(IG_EMBED);
    expect(parsed?.author).toBe("mikeshothoney");
    expect(parsed?.caption.split("\n")[0]).toBe("The gameday recipe we never get tired of");
    expect(parsed?.caption).toContain("- 2 chicken breasts");
    expect(parsed?.caption).not.toContain("<br>");
    expect(parsed?.caption).not.toContain("mikeshothoney");
  });

  it("returns nothing for an embed without a caption block", () => {
    expect(instagramCaption("<html><body>Login</body></html>")).toBeNull();
  });

  it("reads the Open Graph description TikTok serves", () => {
    const html = `<meta property="og:description" content="Chili Garlic Pasta &#10; 2 tbsp butter &#38; 1 onion">`;
    expect(metaContent(html, "og:description")).toBe("Chili Garlic Pasta \n 2 tbsp butter & 1 onion");
  });

  it("reads a description that comes before the property", () => {
    const html = `<meta content="Description first" property="og:description">`;
    expect(metaContent(html, "og:description")).toBe("Description first");
  });
});
