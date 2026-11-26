import { describe, expect, it } from "vitest";
import {
  instagramCaption,
  instagramPageCaption,
  instagramPostUrl,
  instagramShortcode,
  metaContent,
} from "./public-video";

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

describe("Instagram post addresses", () => {
  it("reads every post shape and ignores tracking parameters", () => {
    expect(instagramShortcode("https://www.instagram.com/reels/Df2nAp7u3xm/?lqvp=x")).toBe(
      "Df2nAp7u3xm",
    );
    expect(instagramShortcode("https://www.instagram.com/reel/Dfz2k2loP_y/")).toBe("Dfz2k2loP_y");
    expect(instagramShortcode("https://www.instagram.com/someuser/reel/DeRNOl4u6lf/")).toBe(
      "DeRNOl4u6lf",
    );
    expect(instagramShortcode("https://www.instagram.com/p/DfsoKTHpLgQ/")).toBe("DfsoKTHpLgQ");
    expect(instagramShortcode("https://www.instagram.com/reels/audio/123/")).toBeNull();
    expect(instagramShortcode("https://www.instagram.com/someuser/")).toBeNull();
  });

  it("builds one canonical post URL", () => {
    expect(instagramPostUrl("https://www.instagram.com/reels/Df2nAp7u3xm/?cplk=x")).toBe(
      "https://www.instagram.com/reel/Df2nAp7u3xm/",
    );
    expect(instagramPostUrl("https://www.instagram.com/p/DfsoKTHpLgQ/")).toBe(
      "https://www.instagram.com/p/DfsoKTHpLgQ/",
    );
    expect(instagramPostUrl("https://example.com/reel/Df2nAp7u3xm/")).toBeNull();
  });
});

describe("Instagram post data in the page", () => {
  const page = `<html><body><script type="application/json">{"require":[[{"node":{"code":"Df2nAp7u3xm","user":{"username":"cook"},"caption":{"text":"Zutaten:\\n- 200 g Mehl\\n\\nZubereitung:\\n1. Mischen."}}}]]}</script></body></html>`;

  it("finds the media object with the requested shortcode", () => {
    const found = instagramPageCaption(page, "Df2nAp7u3xm");
    expect(found?.author).toBe("cook");
    expect(found?.caption).toContain("- 200 g Mehl");
  });

  it("ignores a feed of other posts", () => {
    const other = page.replace(/Df2nAp7u3xm/g, "DgHAP3vslN9");
    expect(instagramPageCaption(other, "Df2nAp7u3xm")).toBeNull();
  });
});
