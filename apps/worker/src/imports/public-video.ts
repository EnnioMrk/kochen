import { fetchPage } from "../fetch-source";
import { instagramCookieHeader } from "./instagram-session";
import { platformOf } from "./platform-login";
import { renderHtml } from "./render-page";

export type PublicVideoInfo = {
  title: string | null;
  description: string | null;
  author: string | null;
};

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Instagram serves the post data in the HTML to a crawler, not to a browser. */
const CRAWLER_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

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

/**
 * Instagram writes a post in several shapes: /p/, /reel/, /reels/ and /tv/,
 * with an optional user name before the type. All of them carry one shortcode.
 */
export function instagramShortcode(url: string): string | null {
  return instagramPost(url)?.code ?? null;
}

type InstagramPost = { type: string; code: string };

function instagramPost(url: string): InstagramPost | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "instagram.com") return null;
  const path = parsed.pathname;
  const match = /^\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{3,})/.exec(path);
  if (!match) return null;
  const code = match[2] ?? "";
  if (!code || code === "audio") return null;
  const type = match[1] === "reels" ? "reel" : (match[1] ?? "reel");
  return { type, code };
}

/** The canonical post URL: no tracking parameters, one path shape. */
export function instagramPostUrl(url: string): string | null {
  const post = instagramPost(url);
  return post ? `https://www.instagram.com/${post.type}/${post.code}/` : null;
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
  const post = instagramPost(url);
  return post ? `https://www.instagram.com/${post.type}/${post.code}/embed/captioned/` : null;
}

type InstagramMedia = { author: string | null; caption: string };

/**
 * The post page also serves its data as JSON to a crawler. The media object
 * with our shortcode holds the caption, so no browser is needed. Instagram
 * serves a feed of other posts when the requested post is restricted.
 */
export function instagramPageCaption(html: string, shortcode: string): InstagramMedia | null {
  const scripts = html.matchAll(
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const script of scripts) {
    let root: unknown;
    try {
      root = JSON.parse(script[1] ?? "");
    } catch {
      continue;
    }
    const found = findInstagramMedia(root, shortcode);
    if (found) return found;
  }
  return null;
}

function findInstagramMedia(root: unknown, shortcode: string): InstagramMedia | null {
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0 && steps < 500_000) {
    steps += 1;
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (!Array.isArray(value)) {
      const node = value as Record<string, unknown>;
      const code = node.code ?? node.shortcode;
      const caption = node.caption as { text?: unknown } | undefined;
      if (
        (code === shortcode) &&
        caption &&
        typeof caption.text === "string" &&
        caption.text.trim()
      ) {
        const user = node.user as { username?: unknown } | undefined;
        const owner = node.owner as { username?: unknown } | undefined;
        const author =
          typeof user?.username === "string"
            ? user.username
            : typeof owner?.username === "string"
              ? owner.username
              : null;
        return { author, caption: caption.text.trim() };
      }
    }
    for (const key in value) {
      stack.push((value as Record<string, unknown>)[key]);
    }
  }
  return null;
}

/**
 * A crawler user agent makes Instagram render the post data in the HTML.
 * A browser user agent only gets an empty shell.
 */
async function instagramPage(url: string, cookies: string | null): Promise<string | null> {
  const post = instagramPostUrl(url);
  if (!post) return null;
  try {
    const headers: Record<string, string> = { "user-agent": CRAWLER_UA, accept: "text/html" };
    const cookieHeader = cookies ? instagramCookieHeader(cookies) : "";
    if (cookieHeader) headers.cookie = cookieHeader;
    const response = await fetch(post, {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function instagramInfoFrom(media: InstagramMedia): PublicVideoInfo {
  const firstLine = media.caption.split("\n").map((line) => line.trim()).find(Boolean) ?? null;
  return {
    title: firstLine ? firstLine.slice(0, 200) : null,
    description: media.caption.slice(0, 12_000),
    author: media.author,
  };
}

async function instagramInfo(url: string, cookies: string | null): Promise<PublicVideoInfo | null> {
  const code = instagramShortcode(url);
  if (!code) return null;

  const page = await instagramPage(url, cookies);
  if (page) {
    const fromPage = instagramPageCaption(page, code);
    if (fromPage) return instagramInfoFrom(fromPage);
  }

  const embedUrl = instagramEmbedUrl(url);
  if (!embedUrl) return null;
  const html = await renderHtml(embedUrl, 12_000);
  if (!html) return null;
  const parsed = instagramCaption(html);
  if (!parsed) return null;
  return instagramInfoFrom({ author: parsed.author, caption: parsed.caption });
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
 * plain client is a login wall. `cookies` adds a session for a restricted
 * Instagram post.
 */
export async function publicVideoInfo(
  url: string,
  cookies: string | null = null,
): Promise<PublicVideoInfo | null> {
  const platform = platformOf(url);
  const embedded = await oembed(url);
  if (embedded) return embedded;

  if (platform === "instagram") {
    const info = await instagramInfo(url, cookies);
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
