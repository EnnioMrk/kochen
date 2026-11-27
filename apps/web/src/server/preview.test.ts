import { describe, expect, it } from "vitest";
import { escapeHtml, injectHead, metaTags, shorten, sitePreview } from "./preview";

const SITE = `<!doctype html><html><head>
    <title>Rezeptor</title>
    <meta name="robots" content="noindex, nofollow" />
    <!-- og:start -->
    <meta property="og:title" content="Rezeptor" />
    <!-- og:end -->
  </head><body><div id="root"></div></body></html>`;

describe("shorten", () => {
  it("keeps a short text unchanged", () => {
    expect(shorten("Ofengemüse mit Feta", 90)).toBe("Ofengemüse mit Feta");
  });

  it("collapses line breaks and repeated spaces", () => {
    expect(shorten("  Chili\n\n  Garlic\tPasta ", 90)).toBe("Chili Garlic Pasta");
  });

  it("cuts on a word edge and marks the cut", () => {
    const text = shorten("Ein sehr langer Titel mit vielen Wörtern und noch mehr Wörtern", 30);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(31);
    expect(text).not.toContain("Wörte…");
  });
});

describe("escapeHtml", () => {
  it("closes the quote that would break an attribute", () => {
    expect(escapeHtml(`Feta "mit" & <Kräutern>`)).toBe(
      "Feta &quot;mit&quot; &amp; &lt;Kräutern&gt;",
    );
  });
});

describe("metaTags", () => {
  const tags = metaTags({
    title: "Ofengemüse mit Feta",
    description: "Rezept von Anna · 4 Portionen",
    url: "https://rezeptor.ennio.vip/r/abc?link=t",
    image: "https://rezeptor.ennio.vip/r/abc/preview.jpg?link=t",
    imageAlt: "Rezept: Ofengemüse mit Feta",
    type: "article",
  });

  it("carries the tags a chat app reads", () => {
    expect(tags).toContain('property="og:title" content="Ofengemüse mit Feta"');
    expect(tags).toContain('property="og:description" content="Rezept von Anna · 4 Portionen"');
    expect(tags).toContain('property="og:image:width" content="1200"');
    expect(tags).toContain('property="og:image:height" content="630"');
    expect(tags).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("describes the card shape the image route serves", () => {
    expect(tags).toContain('property="og:image" content="https://rezeptor.ennio.vip/r/abc/preview.jpg?link=t"');
  });
});

describe("injectHead", () => {
  const meta = sitePreview("https://rezeptor.ennio.vip");

  it("replaces the marked block instead of adding a second one", () => {
    const html = injectHead(SITE, meta);
    expect(html.match(/og:title/g)).toHaveLength(1);
    expect(html).not.toContain('content="Rezeptor" />\n    <!-- og:end -->');
  });

  it("writes the card title into the document title", () => {
    const html = injectHead(SITE, { ...meta, title: "Rezeptor – Rezepte, die bleiben." });
    expect(html).toContain("<title>Rezeptor – Rezepte, die bleiben.</title>");
  });

  it("stays stable when it runs twice", () => {
    const once = injectHead(SITE, meta);
    const twice = injectHead(once, meta);
    expect(twice).toBe(once);
  });

  it("escapes a title that carries markup", () => {
    const html = injectHead(SITE, { ...meta, title: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the app shell intact", () => {
    expect(injectHead(SITE, meta)).toContain('<div id="root"></div>');
    expect(injectHead(SITE, meta)).toContain('name="robots" content="noindex, nofollow"');
  });
});
