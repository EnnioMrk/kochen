import { fetchPage } from "../fetch-source";
import { platformOf } from "./platform-login";

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
      const code = entity.startsWith("#x") || entity.startsWith("#X")
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
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

function metaContent(html: string, key: string): string | null {
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
 * Title and description without media and without a login. oEmbed is the
 * stable route; the Open Graph tags of the page are the fallback.
 */
export async function publicVideoInfo(url: string): Promise<PublicVideoInfo | null> {
  const platform = platformOf(url);
  const embedded = await oembed(url);
  if (embedded) return embedded;

  try {
    const page = await fetchPage(url);
    const title = metaContent(page.html, "og:title") ?? metaContent(page.html, "twitter:title");
    const description =
      metaContent(page.html, "og:description") ?? metaContent(page.html, "twitter:description");
    if (!title) return null;
    // A login wall answers with the platform name alone. That is no recipe.
    const generic = ["instagram", "tiktok", "youtube", "log in", "login", "anmelden"];
    if (generic.includes(title.trim().toLowerCase())) return null;
    return {
      title: title.slice(0, 200),
      description: description ? description.slice(0, 4000) : null,
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
