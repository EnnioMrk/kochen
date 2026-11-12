import { fetchPage } from "../fetch-source";
import { platformOf } from "./platform-login";
import { renderHtml } from "./render-page";

export type PublicVideoInfo = {
  title: string | null;
  description: string | null;
  author: string | null;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code =
        entity.startsWith("#x") || entity.startsWith("#X")
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/[ \t]{2,}/g, " ").trim();
}

async function oembed(url: string): Promise<PublicVideoInfo | null> {
  const platform = platformOf(url);
  const endpoint =
    platform === "youtube"
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : platform === "tiktok"
        ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
        : null;
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { title?: unknown; author_name?: unknown };
    const title = typeof data.title === "string" ? data.title.trim() : "";
    if (!title) return null;
    return {
      title: title.slice(0, 200),
      description: null,
      author: typeof data.author_name === "string" ? data.author_name.slice(0, 120) : null,
    };
  } catch {
    return null;
  }
}

export function metaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return null;
}

/** The `.Caption` block of an Instagram embed: the author link, then the text. */
export function instagramCaption(html: string): { author: string | null; caption: string } | null {
  const marker = html.indexOf('class="Caption"');
  if (marker < 0) return null;
  const open = html.indexOf(">", marker);
  if (open < 0) return null;
  const end = html.indexOf("</div>", open);
  if (end < 0) return null;
  const block = html.slice(open + 1, end);
  const author = /<a[^>]+class="CaptionUsername"[^>]*>([^<]+)<\/a>/i.exec(block)?.[1]?.trim() ?? null;
  const body = block
    .replace(/<a[^>]*class="CaptionUsername"[^>]*>[^<]*<\/a>/i, "")
    .replace(/<br\s*\/?>/gi, "\n");
  const caption = stripTags(body);
  if (!caption) return null;
  return { author: author ? decodeEntities(author) : null, caption };
}

function instagramEmbedUrl(url: string): string | null {
  const match = /instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/i.exec(url);
  if (!match) return null;
  return `https://www.instagram.com/${match[1]}/${match[2]}/embed/captioned/`;
}

async function instagramInfo(url: string): Promise<PublicVideoInfo | null> {
  const embedUrl = instagramEmbedUrl(url);
  if (!embedUrl) return null;
  const html = await renderHtml(embedUrl, 12_000);
  if (!html) return null;
  const parsed = instagramCaption(html);
  if (!parsed) return null;
  const firstLine = parsed.caption.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
  return {
    title: firstLine ? firstLine.slice(0, 200) : null,
    description: parsed.caption.slice(0, 12_000),
    author: parsed.author,
  };
}

async function tiktokInfo(url: string): Promise<PublicVideoInfo | null> {
  const canonical = /^https?:\/\//i.test(url) ? url.split("?")[0] ?? url : null;
  if (!canonical) return null;
  const html = await renderHtml(canonical, 12_000);
  if (!html) return null;
  const description = metaContent(html, "og:description") ?? metaContent(html, "twitter:description");
  if (!description) return null;
  if (["tiktok", "log in", "login"].includes(description.trim().toLowerCase())) return null;
  const firstLine = description.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
  return {
    title: firstLine ? firstLine.slice(0, 200) : null,
    description: description.slice(0, 12_000),
    author: null,
  };
}

/**
 * Title and description without media and without a login. YouTube answers
 * oEmbed; Instagram and TikTok need a rendered page, because their HTML for a
 * plain client is a login wall.
 */
export async function publicVideoInfo(url: string): Promise<PublicVideoInfo | null> {
  const platform = platformOf(url);
  const embedded = await oembed(url);
  if (embedded) return embedded;

  if (platform === "instagram") {
    const info = await instagramInfo(url);
    if (info) return info;
  }
  if (platform === "tiktok") {
    const info = await tiktokInfo(url);
    if (info) return info;
  }

  try {
    const page = await fetchPage(url);
    const title = metaContent(page.html, "og:title") ?? metaContent(page.html, "twitter:title");
    const description =
      metaContent(page.html, "og:description") ?? metaContent(page.html, "twitter:description");
    if (!title) return null;
    const generic = ["instagram", "tiktok", "youtube", "log in", "login", "anmelden"];
    if (generic.includes(title.trim().toLowerCase())) return null;
    return {
      title: title.slice(0, 200),
      description: description ? description.slice(0, 12_000) : null,
      author: null,
    };
  } catch {
    return null;
  }
}

export function platformLabel(platform: string | null): string {
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  if (platform === "tiktok") return "TikTok";
  return "Die Plattform";
}
