import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { parseAmount, detectBaking } from "@kochen/core";
import { JobFailure } from "./errors";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

export type FetchedPage = {
  finalUrl: string;
  html: string;
};

/* ------------------------------------------------------------ SSRF helpers */

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const a = parts[0] as number;
  const b = parts[1] as number;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(raw: string): boolean {
  const ip = (raw.toLowerCase().split("%")[0] ?? raw).trim();
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) {
    return true;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (ip.startsWith("ff")) return true;
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted?.[1]) return isPrivateIpv4(dotted[1]);
  // ::ffff:7f00:1 (hex-encoded IPv4)
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hex?.[1] && hex[2]) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    const v4 = `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    return isPrivateIpv4(v4);
  }
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

type LookupOptions = { family?: number; hints?: number; all?: boolean };
type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** DNS lookup used by the request itself: rebinding cannot swap in a private IP. */
function guardedLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      const publicAddresses = addresses.filter((entry) => !isPrivateAddress(entry.address));
      if (publicAddresses.length === 0 || publicAddresses.length !== addresses.length) {
        const error: NodeJS.ErrnoException = new Error("ssrf_blocked");
        error.code = "ESSRFBLOCKED";
        callback(error, "", 0);
        return;
      }
      const first = publicAddresses[0];
      if (!first) {
        callback(Object.assign(new Error("ssrf_blocked"), { code: "ESSRFBLOCKED" }), "", 0);
        return;
      }
      if (options.all) callback(null, publicAddresses);
      else callback(null, first.address, first.family);
    })
    .catch((error: NodeJS.ErrnoException) => callback(error, "", 0));
}

/* --------------------------------------------------------------- transport */

type RawResponse = {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer;
};

function decodeBody(body: Buffer, contentEncoding: string): Buffer {
  const options = { maxOutputLength: MAX_BYTES };
  try {
    if (contentEncoding.includes("br")) return brotliDecompressSync(body, options);
    if (contentEncoding.includes("gzip")) return gunzipSync(body, options);
    if (contentEncoding.includes("deflate")) return inflateSync(body, options);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_BUFFER_TOO_LARGE" || code === "ERR_OUT_OF_RANGE") {
      throw new JobFailure("limit_exceeded", "Die Seite ist größer als 5 MB und kann nicht gelesen werden.");
    }
    return body;
  }
  return body;
}

function readCapped(stream: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stopped = false;
    stream.on("data", (chunk: Buffer) => {
      if (stopped) return;
      size += chunk.length;
      if (size > MAX_BYTES) {
        stopped = true;
        stream.destroy();
        reject(
          new JobFailure("limit_exceeded", "Die Seite ist größer als 5 MB und kann nicht gelesen werden."),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (!stopped) resolve(Buffer.concat(chunks));
    });
    stream.on("error", (error) => {
      if (!stopped) reject(error);
    });
  });
}

function requestOnce(url: URL, deadline: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new JobFailure("source_unavailable", "Die Seite hat nicht rechtzeitig geantwortet.", true));
      return;
    }
    const isHttps = url.protocol === "https:";
    const request = isHttps ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        method: "GET",
        lookup: guardedLookup as never,
        timeout: remaining,
        headers: {
          // Recipe sites answer a bot user agent with 403. A normal browser
          // string is the only way to read the page the member can see.
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "de-DE,de;q=0.9,en;q=0.6",
          "accept-encoding": "gzip, deflate, br",
          "cache-control": "no-cache",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers["content-type"] ?? "");
        const location = response.headers.location ?? null;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, contentType, body: Buffer.alloc(0) });
          return;
        }
        readCapped(response)
          .then((raw) => {
            const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
            const body = decodeBody(raw, encoding);
            if (body.byteLength > MAX_BYTES) {
              reject(
                new JobFailure("limit_exceeded", "Die Seite ist größer als 5 MB und kann nicht gelesen werden."),
              );
              return;
            }
            resolve({ status, location, contentType, body });
          })
          .catch(reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new JobFailure("source_unavailable", "Die Seite hat nicht rechtzeitig geantwortet.", true));
    });
    req.on("error", (error) => {
      if (error instanceof JobFailure) {
        reject(error);
        return;
      }
      const message = error.message.includes("ssrf")
        ? "Die Adresse verweist auf ein internes Netzwerk und wird nicht geladen."
        : "Die Seite konnte nicht geladen werden.";
      reject(new JobFailure("source_unavailable", message, true));
    });
    req.end();
  });
}

function asWebUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JobFailure("invalid_source", "Die Adresse ist ungültig.");
  }
  assertScheme(url);
  if (url.username || url.password) {
    throw new JobFailure("invalid_source", "Adressen mit Zugangsdaten werden nicht geladen.");
  }
  return url;
}

function assertScheme(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new JobFailure("invalid_source", "Es werden nur http- und https-Adressen geladen.");
  }
}

function decodeBodyText(body: Buffer, contentType: string): string {
  const match = /charset=([^;]+)/i.exec(contentType);
  const charset = (match?.[1] ?? "utf-8").trim().replace(/^["']|["']$/g, "") || "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

function isTextContentType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return (
    type.includes("text/html") ||
    type.includes("application/xhtml+xml") ||
    type.includes("text/plain") ||
    type.includes("application/xml") ||
    type.includes("text/xml")
  );
}

/** Scheme + DNS check for non-HTTP validated sources such as yt-dlp video URLs. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = asWebUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const blocked = new JobFailure(
    "invalid_source",
    "Die Adresse verweist auf ein internes Netzwerk und wird nicht geladen.",
  );
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw blocked;
    return url;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new JobFailure("source_unavailable", "Die Adresse konnte nicht aufgelöst werden.", true);
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw blocked;
  }
  return url;
}

/**
 * One German sentence per refusal. A site that blocks the reader cannot be
 * fetched, but a screenshot of the same page still works, so the text says so
 * and the review offers the screenshot panel.
 */
function statusFailure(status: number): JobFailure {
  if (status === 401 || status === 403) {
    return new JobFailure(
      "source_blocked",
      `Die Seite lässt den Import nicht zu (HTTP ${status}). Bitte lade einen Screenshot des Rezepts hoch.`,
    );
  }
  if (status === 429) {
    return new JobFailure(
      "source_blocked",
      "Die Seite begrenzt gerade die Anfragen (HTTP 429). Bitte warte einen Moment oder lade einen Screenshot hoch.",
    );
  }
  if (status === 404 || status === 410) {
    return new JobFailure("invalid_source", `Die Seite wurde nicht gefunden (HTTP ${status}).`);
  }
  if (status >= 500) {
    return new JobFailure(
      "source_unavailable",
      `Die Seite ist gerade nicht erreichbar (HTTP ${status}).`,
      true,
    );
  }
  return new JobFailure("invalid_source", `Die Seite hat die Anfrage abgelehnt (HTTP ${status}).`);
}

/** Fetch one recipe page with scheme, DNS, redirect, timeout and size guards. */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let current = asWebUrl(rawUrl);
  const deadline = Date.now() + TIMEOUT_MS;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestOnce(current, deadline);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) {
        throw new JobFailure("invalid_source", "Die Seite leitet ohne Ziel weiter.");
      }
      if (hop === MAX_REDIRECTS) {
        throw new JobFailure("invalid_source", "Die Seite leitet zu oft weiter.");
      }
      current = asWebUrl(new URL(response.location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw statusFailure(response.status);
    }
    if (!isTextContentType(response.contentType)) {
      throw new JobFailure("invalid_source", "Die Adresse ist keine lesbare Webseite.");
    }
    return { finalUrl: current.toString(), html: decodeBodyText(response.body, response.contentType) };
  }
  throw new JobFailure("invalid_source", "Die Seite leitet zu oft weiter.");
}

/* ------------------------------------------------------------ JSON-LD parse */

function collectJsonLd(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectJsonLd(entry, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  out.push(node);
  const graph = node["@graph"];
  if (graph) collectJsonLd(graph, out);
  const main = node.mainEntity;
  if (main) collectJsonLd(main, out);
}

function isRecipeNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type.toLowerCase() === "recipe";
  if (Array.isArray(type)) {
    return type.some((entry) => typeof entry === "string" && entry.toLowerCase() === "recipe");
  }
  return false;
}

function instructionSteps(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((entry) => instructionSteps(entry));
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (item.itemListElement) return instructionSteps(item.itemListElement);
    if (typeof item.text === "string" && item.text.trim()) return [item.text.trim()];
    if (typeof item.name === "string" && item.name.trim()) return [item.name.trim()];
  }
  return [];
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => stringList(entry));
  return [];
}

function firstImage(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstImage(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const url = (value as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return null;
}

export type JsonLdRecipe = {
  draft: Record<string, unknown>;
  rawText: string;
  sourceLang: string | null;
};

/**
 * Read the first schema.org Recipe node. Most recipe sites carry the full
 * recipe here, which is exact and free (no model call).
 */
export function parseRecipeJsonLd(html: string, pageUrl: string): JsonLdRecipe | null {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url: pageUrl });
  } catch {
    return null;
  }
  const document = dom.window.document;
  const nodes: Record<string, unknown>[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      collectJsonLd(JSON.parse(raw) as unknown, nodes);
    } catch {
      // Broken JSON-LD on one script must not lose the page.
    }
  }
  const recipe = nodes.find(isRecipeNode);
  if (!recipe) return null;

  const title = typeof recipe.name === "string" ? recipe.name : "";
  const description = typeof recipe.description === "string" ? recipe.description : null;
  const yields = Array.isArray(recipe.recipeYield)
    ? recipe.recipeYield[0]
    : recipe.recipeYield;
  const servings =
    typeof yields === "number"
      ? yields
      : typeof yields === "string"
        ? (parseAmount(yields) ?? null)
        : null;
  const keywords = stringList(recipe.keywords).join(",");
  const categories = stringList(recipe.recipeCategory);
  const tags = [...keywords.split(","), ...categories]
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
  const sourceLang =
    typeof recipe.inLanguage === "string"
      ? recipe.inLanguage.slice(0, 16)
      : Array.isArray(recipe.inLanguage) && typeof recipe.inLanguage[0] === "string"
        ? (recipe.inLanguage[0] as string).slice(0, 16)
        : null;

  const bodyText = (document.body?.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 200_000);

  const stepTexts = instructionSteps(recipe.recipeInstructions);
  // Baking data only when the source itself states it; detection is conservative.
  const baking = detectBaking(...stepTexts, description ?? "");

  return {
    draft: {
      title,
      description,
      servings,
      bakingTemperature: baking.bakingTemperature,
      bakingTime: baking.bakingTime,
      ingredients: stringList(recipe.recipeIngredient),
      steps: stepTexts,
      tags,
      sourceLang,
      sourceUrl: pageUrl,
      rawText: bodyText,
      image: firstImage(recipe.image),
      totalTime: typeof recipe.totalTime === "string" ? recipe.totalTime : null,
    },
    rawText: bodyText,
    sourceLang,
  };
}

/* ------------------------------------------------------------- Readability */

/** Readable article text for the model fallback path. */
export function readableText(html: string, pageUrl: string): string {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url: pageUrl });
  } catch {
    return "";
  }
  const document = dom.window.document;
  try {
    const article = new Readability(document.cloneNode(true) as Document).parse();
    const text = (article?.textContent ?? "").replace(/[ \t]+/g, " ").trim();
    if (text.length >= 40) return text.slice(0, 200_000);
  } catch {
    // Fall through to the body text.
  }
  return (document.body?.textContent ?? "").replace(/[ \t]+/g, " ").trim().slice(0, 200_000);
}
