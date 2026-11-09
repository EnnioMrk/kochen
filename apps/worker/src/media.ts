import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./config";
import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/** Local disk fallback shared with the web container through a volume. */
function mediaDir(): string {
  return process.env.MEDIA_DIR ?? "/data/media";
}

function safeKey(key: string): string {
  const clean = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "").replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || clean.includes("..") || !/^[a-zA-Z0-9/_.-]+$/.test(clean)) {
    throw new MediaError("bad_media_key");
  }
  return clean;
}

function signLocal(key: string): string {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const secret = process.env.MEDIA_SECRET ?? "dev-media-secret";
  const signature = createHmac("sha256", secret).update(`${key}:${expires}`).digest("hex");
  return `${env.appOrigin}/api/media/file/${safeKey(key)}?e=${expires}&s=${signature}`;
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    const r2 = env.r2;
    client = new S3Client({
      region: r2.region,
      endpoint: r2.endpoint,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
      forcePathStyle: true,
    });
  }
  return client;
}

export function r2Configured(): boolean {
  return env.r2Configured;
}

export async function getObject(key: string): Promise<Uint8Array> {
  if (!env.r2Configured) {
    try {
      const bytes = await readFile(join(mediaDir(), safeKey(key)));
      if (bytes.byteLength === 0) throw new MediaError("empty_object");
      return new Uint8Array(bytes);
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError("object_missing");
    }
  }
  const result = await s3().send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes || bytes.byteLength === 0) throw new MediaError("empty_object");
  return bytes;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (!env.r2Configured) {
    const path = join(mediaDir(), safeKey(key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return;
  }
  await s3().send(
    new PutObjectCommand({ Bucket: env.r2.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Signed GET for print images. One hour is enough for one Chromium render. */
export async function signedGet(key: string, expiresIn = 3600): Promise<string> {
  if (!env.r2Configured) return signLocal(key);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }), { expiresIn });
}

export async function deleteObject(key: string): Promise<void> {
  if (!env.r2Configured) {
    await rm(join(mediaDir(), safeKey(key)), { force: true }).catch(() => {});
    return;
  }
  await s3().send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: key })).catch(() => {});
}

/** Key for a processed derivative of an upload (variants, cover frames). */
export function derivedKey(sourceKey: string, suffix: string, extension: string): string {
  const base = sourceKey.replace(/\.[a-zA-Z0-9]{1,8}$/, "");
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${base}-${safeSuffix}.${extension}`;
}

/** Fresh key for generated media such as a video cover frame. */
export function mediaKey(prefix: string, name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${clean}`;
}

export function exportKey(recipeId: string, timestamp = Date.now()): string {
  return `exports/${recipeId}/${timestamp}.pdf`;
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaError";
  }
}
