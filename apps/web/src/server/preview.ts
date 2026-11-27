/**
 * Link previews for WhatsApp, iMessage and the other chat apps.
 *
 * A chat app reads the first HTML it gets and shows og:title, og:description
 * and og:image. The app is one single-page build for every route, so the
 * server fills that block for the two routes a person shares: a recipe link
 * and a friend invite.
 *
 * A crawler sends no cookies. For a recipe, the private link token in the URL
 * is the credential the sender already holds, and it is checked again before
 * the page or the card image is sent. Without a token the crawler gets the
 * quiet site card, never a title it may not see.
 */

import { readFile } from "node:fs/promises";
import type { Context } from "hono";
import { Hono } from "hono";
import { db } from "@rezeptor/db";
import { sha256hex } from "./crypto";
import { getObject } from "./media";
import { getRecipeRow } from "./repo";
import type { AppEnv } from "./types";

export const OG_START = "<!-- og:start -->";
export const OG_END = "<!-- og:end -->";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkPreview = {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  type: "website" | "article";
};

/* ------------------------------------------------------------ html helpers */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line, no control characters, and never a cut word. */
export function shorten(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The tags every card carries. Both chats and social apps read this set. */
export function metaTags(meta: LinkPreview): string {
  const tags = [
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.url)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="Rezeptor" />`,
    `<meta property="og:locale" content="de_DE" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.url)}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.image)}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="${CARD_WIDTH}" />`,
    `<meta property="og:image:height" content="${CARD_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(meta.image)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt)}" />`,
  ];
  return tags.map((tag) => `    ${tag}`).join("\n");
}

/**
 * Replace the marked block of the built page. The markers stop a second set of
 * tags from stacking up beside the defaults in `index.html`.
 */
export function injectHead(html: string, meta: LinkPreview): string {
  const block = `${OG_START}\n${metaTags(meta)}\n    ${OG_END}`;
  const withBlock = html.replace(new RegExp(`${OG_START}[\\s\\S]*?${OG_END}`), block);
  const titled = withBlock.includes(OG_START)
    ? withBlock
    : withBlock.replace("</head>", `  ${block}\n  </head>`);
  return titled.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
}

let cachedIndex: Promise<string | null> | null = null;

/** The built page, read once. The image ships both `dist` and `public`. */
function indexHtml(): Promise<string | null> {
  // The build first. The source file keeps a dev run and the tests working.
  cachedIndex ??= readFile(new URL("../../dist/index.html", import.meta.url), "utf8").catch(() =>
    readFile(new URL("../../index.html", import.meta.url), "utf8").catch(() => null),
  );
  return cachedIndex;
}

/** The origin the crawler used. Traefik ends TLS and sets the header. */
export function requestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const forwarded = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const local = url.hostname === "localhost" || url.hostname.startsWith("127.");
  const proto = forwarded || (local ? url.protocol.replace(":", "") : "https");
  return `${proto}://${url.host}`;
}

export function sitePreview(origin: string): LinkPreview {
  return {
    title: "Rezeptor – Rezepte sammeln, teilen, kochen",
    description:
      "Eigene Rezepte per Link oder Foto erfassen, prüfen und Schritt für Schritt kochen. Freunde lesen und kommentieren mit.",
    url: `${origin}/`,
    image: `${origin}/og/site.jpg`,
    imageAlt: "Rezeptor – Rezepte, die bleiben.",
    type: "website",
  };
}

/* ------------------------------------------------------------------- data */

async function linkOpens(recipeId: string, token: string): Promise<boolean> {
  const hash = await sha256hex(token);
  const sql = db();
  const rows = await sql<{ ok: boolean }[]>`
    select true as ok from private_links
    where token_hash = ${hash} and recipe_id = ${recipeId} and revoked_at is null
  `;
  return rows.length > 0;
}

async function coverKey(recipeId: string): Promise<string | null> {
  const sql = db();
  const rows = await sql<{ key: string }[]>`
    select r2_key as key from images
    where recipe_id = ${recipeId} and kind in ('cover', 'original')
    order by case when kind = 'cover' then 0 else 1 end, position
    limit 1
  `;
  return rows[0]?.key ?? null;
}

/** The cover key, when the token opens the recipe. Null: use the site card. */
export async function previewCoverKey(recipeId: string, token: string): Promise<string | null> {
  if (!UUID.test(recipeId) || token.length < 10) return null;
  const row = await getRecipeRow(recipeId);
  if (!row || row.deletedAt || row.visibility === "private") return null;
  if (!(await linkOpens(recipeId, token))) return null;
  return coverKey(recipeId);
}

export async function recipePreview(
  recipeId: string,
  token: string,
  origin: string,
): Promise<LinkPreview | null> {
  if (!UUID.test(recipeId) || token.length < 10) return null;
  const row = await getRecipeRow(recipeId);
  if (!row || row.deletedAt || row.visibility === "private") return null;
  if (!(await linkOpens(recipeId, token))) return null;
  const sql = db();
  const counts = await sql<{ ingredients: number; steps: number }[]>`
    select
      (select count(*)::int from recipe_ingredients where recipe_id = ${recipeId}) as ingredients,
      (select count(*)::int from recipe_steps where recipe_id = ${recipeId}) as steps
  `;
  const ingredients = counts[0]?.ingredients ?? 0;
  const steps = counts[0]?.steps ?? 0;
  const parts = [
    `Von ${row.owner.name}`,
    `${row.servings} ${row.servings === 1 ? "Portion" : "Portionen"}`,
  ];
  if (ingredients > 0) parts.push(`${ingredients} Zutaten`);
  if (row.bakingTime) parts.push(row.bakingTime);
  const cover = await coverKey(recipeId);
  const link = `?link=${encodeURIComponent(token)}`;
  return {
    title: shorten(row.title, 90),
    description: shorten(row.description?.trim() || parts.join(" · "), 180),
    url: `${origin}/r/${recipeId}${link}`,
    image: cover ? `${origin}/r/${recipeId}/preview.jpg${link}` : `${origin}/og/site.jpg`,
    imageAlt: `Rezept: ${shorten(row.title, 80)}`,
    type: "article",
  };
}

export async function invitePreview(
  token: string,
  origin: string,
): Promise<LinkPreview | null> {
  if (token.length < 10) return null;
  const hash = await sha256hex(token);
  const sql = db();
  const rows = await sql<{ name: string }[]>`
    select u.name from friend_invites f join users u on u.id = f.owner_id
    where f.token_hash = ${hash} and f.used_at is null and f.expires_at > now()
  `;
  const name = rows[0]?.name?.trim();
  if (!name) return null;
  return {
    title: `${shorten(name, 50)} lädt dich zu Rezeptor ein`,
    description:
      "Rezepte sammeln, mit Freunden teilen und Schritt für Schritt kochen. Deine Einladung wartet.",
    url: `${origin}/f/${encodeURIComponent(token)}`,
    image: `${origin}/og/site.jpg`,
    imageAlt: `${name} lädt dich zu Rezeptor ein`,
    type: "website",
  };
}

/* ------------------------------------------------------------ card images */

const rendered = new Map<string, Buffer>();

/**
 * Crop the cover to the card shape. Sharp loads on first use: a missing native
 * build must not stop the web server, it only sends the static card.
 */
export async function renderCoverCard(key: string): Promise<Buffer> {
  const hit = rendered.get(key);
  if (hit) {
    rendered.delete(key);
    rendered.set(key, hit);
    return hit;
  }
  const { default: sharp } = await import("sharp");
  const bytes = await getObject(key);
  const card = await sharp(bytes, { failOn: "none", limitInputPixels: 40_000_000 })
    .rotate()
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 80, mozjpeg: true, progressive: true, chromaSubsampling: "4:2:0" })
    .toBuffer();
  if (rendered.size >= 40) {
    const oldest = rendered.keys().next().value;
    if (oldest) rendered.delete(oldest);
  }
  rendered.set(key, card);
  return card;
}

let cardFile: Promise<Buffer> | null = null;

export function siteCard(): Promise<Buffer> {
  cardFile ??= readFile(new URL("../../public/og/site.jpg", import.meta.url)).catch(() =>
    readFile(new URL("../../dist/og/site.jpg", import.meta.url)),
  );
  return cardFile;
}

function imageResponse(c: Context<AppEnv>, bytes: Buffer, type: string, cache: string) {
  c.header("content-type", type);
  c.header("cache-control", cache);
  return c.body(new Uint8Array(bytes));
}

/** Serve the built page with a filled preview block, or the plain page. */
async function page(c: Context<AppEnv>, meta: LinkPreview | null) {
  const html = await indexHtml();
  if (!html) return c.notFound();
  return c.html(meta ? injectHead(html, meta) : html);
}

/* ------------------------------------------------------------------ routes */

export const preview = new Hono<AppEnv>();

preview.get("/r/:id/preview.jpg", async (c) => {
  const id = c.req.param("id");
  const token = c.req.query("link") ?? "";
  try {
    const key = await previewCoverKey(id, token);
    // The URL carries the link token: no shared cache may keep it, and a
    // revoked link must stop serving the cover at once.
    if (key) return imageResponse(c, await renderCoverCard(key), "image/jpeg", "private, no-store");
  } catch {
    // A broken cover never blocks the fallback card.
  }
  return imageResponse(c, await siteCard(), "image/jpeg", "public, max-age=3600");
});

preview.get("/r/:id", async (c) => {
  const origin = requestOrigin(c);
  try {
    const meta = await recipePreview(c.req.param("id"), c.req.query("link") ?? "", origin);
    if (meta) return page(c, meta);
  } catch {
    // Fall through to the static page.
  }
  return page(c, null);
});

preview.get("/f/:token", async (c) => {
  const origin = requestOrigin(c);
  try {
    const meta = await invitePreview(c.req.param("token"), origin);
    if (meta) return page(c, meta);
  } catch {
    // Fall through to the static page.
  }
  return page(c, null);
});
