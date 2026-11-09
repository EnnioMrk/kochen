import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/** Local disk fallback when R2 is not configured. Mount a volume at MEDIA_DIR. */
export function mediaDir(): string {
  return process.env.MEDIA_DIR ?? "/data/media";
}

export function safeKey(key: string): string {
  const clean = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "").replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.includes("..") || !/^[a-zA-Z0-9/_.-]+$/.test(clean)) {
    throw new Error("bad_media_key");
  }
  return clean;
}

export function localPath(key: string): string {
  return join(mediaDir(), safeKey(key));
}

export async function localPut(key: string, bytes: Uint8Array): Promise<void> {
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

export async function localGet(key: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(localPath(key)));
}

export async function localDelete(key: string): Promise<void> {
  await rm(localPath(key), { force: true }).catch(() => {});
}

const encoder = new TextEncoder();

async function hmacHex(message: string): Promise<string> {
  const secret = process.env.MEDIA_SECRET ?? "dev-media-secret";
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const MEDIA_TTL_SECONDS = 3600;

export async function signMediaKey(key: string, ttl = MEDIA_TTL_SECONDS, origin = ""): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const signature = await hmacHex(`${key}:${expires}`);
  return `${origin}/api/media/file/${safeKey(key)}?e=${expires}&s=${signature}`;
}

export async function verifyMediaSignature(key: string, expires: string | undefined, signature: string | undefined): Promise<boolean> {
  if (!expires || !signature) return false;
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;
  const expected = await hmacHex(`${key}:${expiresAt}`);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}
