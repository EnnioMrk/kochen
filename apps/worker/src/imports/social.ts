import type { Limits } from "@rezeptor/contracts";
import { JobFailure } from "../errors";
import { assertPublicUrl, fetchPage } from "../fetch-source";
import { prepareLink, type LinkMaterial } from "./link";
import { platformOf, type PlatformName } from "./platform-login";
import { instagramPostUrl } from "./public-video";
import { prepareVideo, videoSignals, type VideoMaterial } from "./video";

export type SourceMaterial =
  | {
      kind: "video";
      video: VideoMaterial;
      sourceUrl: string;
      signals: string[];
      warnings: string[];
      captionWeak: boolean;
    }
  | {
      kind: "link";
      link: LinkMaterial;
      sourceUrl: string;
      signals: string[];
      warnings: string[];
      captionWeak: boolean;
    };

export type CaptionShape = {
  /** 0..3: ingredients, quantities, steps. */
  score: number;
  /** True when the caption needs a video, a website, or a careful review. */
  weak: boolean;
  hasIngredients: boolean;
  hasQuantities: boolean;
  hasSteps: boolean;
};

const UNIT_WORDS =
  "g|kg|ml|l|tl|el|tbsp|tsp|cup|cups|stück|stueck|prise|zehe|zehen|dose|dosen|packung|packungen|bund|scheibe|scheiben|tasse|tassen|gramm|kilogramm|liter|milliliter|teelöffel|esslöffel";

/**
 * Judge a social caption by the three things a recipe needs: an ingredient
 * list, quantities, and steps. A long caption without numbers is still weak.
 * The threshold is deliberately conservative: a false "weak" only costs one
 * extra fetch, a false "strong" lets the model invent amounts.
 */
export function captionShape(text: string | null | undefined): CaptionShape {
  const raw = (text ?? "").trim();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const ingredientHeading = /(^|\n)\s*(zutaten|ingredients?|für den|für die|für das)\b/i.test(raw);
  const bulletLines = lines.filter(
    (line) => /^[-•*]\s+\S/.test(line) || /^\d+[.)]\s+\S/.test(line),
  ).length;
  const hasIngredients = ingredientHeading || bulletLines >= 3;

  const quantityPattern = new RegExp(
    `(?:\\d+(?:[.,/]\\d+)?|[½¼¾⅓⅔⅛])\\s*(?:${UNIT_WORDS})\\b`,
    "gi",
  );
  const hasQuantities = (raw.match(quantityPattern) ?? []).length >= 2;

  const stepHeading = /(^|\n)\s*(schritt|zubereitung|anleitung|instructions?|method|directions)\b/i.test(
    raw,
  );
  const numberedLines = lines.filter((line) => /^\d+[.)]\s+\S/.test(line)).length;
  const hasSteps = stepHeading || numberedLines >= 2;

  const score = [hasIngredients, hasQuantities, hasSteps].filter(Boolean).length;
  const weak = raw.length < 80 || !hasQuantities || score < 2;
  return { score, weak, hasIngredients, hasQuantities, hasSteps };
}

const SOCIAL_HOSTS = [
  /(^|\.)instagram\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)fb\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)threads\.net$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)pinterest\.[a-z.]+$/i,
  /(^|\.)linktr\.ee$/i,
  /(^|\.)beacons\.ai$/i,
];

function isSocialHost(hostname: string): boolean {
  return SOCIAL_HOSTS.some((pattern) => pattern.test(hostname));
}

/** Plain recipe URLs in a caption, without social links or link hubs. */
export function recipeUrls(text: string | null | undefined): string[] {
  const matches = (text ?? "").match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  const found: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?]+$/, "");
    try {
      const url = new URL(cleaned);
      if (isSocialHost(url.hostname)) continue;
      if (!found.includes(url.toString())) found.push(url.toString());
    } catch {
      // A broken link in a caption is not a reason to fail the import.
    }
  }
  return found.slice(0, 3);
}

export function isSocialUrl(url: string): boolean {
  return platformOf(url) !== null;
}

/**
 * One post, not a profile or a playlist. This keeps a shared link to one
 * recipe and stops a profile URL from turning into a bulk crawl.
 */
export function isSinglePostUrl(url: string, platform: PlatformName): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const path = parsed.pathname;
  if (platform === "instagram") {
    if (/^\/reels\/audio\//.test(path)) return false;
    return /^\/(?:[^/]+\/)?(p|reel|reels|tv)\/[A-Za-z0-9_-]+/.test(path);
  }
  if (platform === "tiktok") {
    if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return true;
    return /^\/@[^/]+\/video\/\d+/.test(path);
  }
  if (platform === "youtube") {
    if (host === "youtu.be") return /^\/[A-Za-z0-9_-]{6,}/.test(path);
    if (path === "/watch") return parsed.searchParams.has("v");
    return /^\/(shorts|embed)\/[A-Za-z0-9_-]+/.test(path);
  }
  return false;
}

/**
 * Instagram's Share button can produce a /share/ link. Follow it once to the
 * canonical post URL before the single-post check.
 */
async function resolveInstagramShare(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "instagram.com" || !parsed.pathname.startsWith("/share/")) return url;
  try {
    const page = await fetchPage(url);
    return page.finalUrl;
  } catch {
    return url;
  }
}

/**
 * Choose what to read for one shared URL.
 *
 * A normal recipe page goes straight to JSON-LD/Readability. A social URL
 * starts with the public caption and the media. When the caption is thin and
 * contains a recipe link, the linked page wins: it has structured data.
 */
export async function prepareSource(inputUrl: string, limits: Limits): Promise<SourceMaterial> {
  const resolved = await resolveInstagramShare(inputUrl);
  const platform = platformOf(resolved);
  if (!platform) {
    const link = await prepareLink(resolved);
    return {
      kind: "link",
      link,
      sourceUrl: link.sourceUrl,
      signals: ["website"],
      warnings: [],
      captionWeak: false,
    };
  }

  if (!isSinglePostUrl(resolved, platform)) {
    throw new JobFailure(
      "invalid_source",
      "Bitte teile einen einzelnen Beitrag. Profile und Übersichten werden nicht importiert.",
    );
  }

  // One canonical address: /reels/ becomes /reel/, and tracking parameters go.
  const url = platform === "instagram" ? (instagramPostUrl(resolved) ?? resolved) : resolved;

  await assertPublicUrl(url);
  const video = await prepareVideo(url, limits);
  const caption = [video.caption, video.authorComment].filter(Boolean).join("\n").trim();
  const shape = captionShape(caption);
  const signals = videoSignals(video);
  const warnings: string[] = [];

  if (shape.weak) {
    const hasMedia = Boolean(video.audio) || video.images.length > 0;
    if (!hasMedia) {
      const candidate = recipeUrls(caption)[0];
      if (candidate) {
        try {
          const link = await prepareLink(candidate);
          if (link.jsonLd || link.extraction) {
            return {
              kind: "link",
              link,
              sourceUrl: candidate,
              signals: [...signals, "website"],
              warnings: [
                "Der Beitragstext ist unvollständig. Der Entwurf stammt von der verlinkten Seite.",
              ],
              captionWeak: true,
            };
          }
        } catch {
          warnings.push("Der Link im Beitrag konnte nicht gelesen werden.");
        }
      }
      warnings.push("Der Beitragstext nennt nicht alle Mengen. Prüfe die Zutaten.");
    } else {
      const media = [video.audio ? "Tonspur" : null, video.images.length > 0 ? "Bilder" : null]
        .filter(Boolean)
        .join(" und ");
      warnings.push(`Der Beitragstext ist unvollständig. ${media} werden gelesen.`);
    }
  }

  return {
    kind: "video",
    video,
    sourceUrl: url,
    signals,
    warnings,
    captionWeak: shape.weak,
  };
}
