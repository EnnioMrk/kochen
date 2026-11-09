import { Hono } from "hono";
import { env } from "../env";
import { requireUser } from "../auth";
import { invalid, notFound, ok } from "../errors";
import { localPut, safeKey, verifyMediaSignature } from "../media-local";
import { readFile } from "node:fs/promises";
import { localPath } from "../media-local";
import type { AppEnv } from "../types";

export const mediaRoutes = new Hono<AppEnv>();

const MAX_BYTES = 50 * 1024 * 1024;

/** Local upload fallback. Only reachable when R2 is not configured. */
mediaRoutes.put("/media/upload", requireUser, async (c) => {
  if (env.r2Configured) throw notFound();
  const key = c.req.query("key") ?? "";
  let clean: string;
  try {
    clean = safeKey(decodeURIComponent(key));
  } catch {
    throw invalid("bad_media_key");
  }
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_BYTES) throw invalid("file_too_large");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw invalid("file_too_large");
  await localPut(clean, bytes);
  return ok(c, { stored: true, key: clean });
});

/** Signed read. Works in an <img> tag without an authorization header. */
mediaRoutes.get("/media/file/:key{.+}", async (c) => {
  const key = c.req.param("key") ?? "";
  let clean: string;
  try {
    clean = safeKey(decodeURIComponent(key));
  } catch {
    throw notFound();
  }
  if (!(await verifyMediaSignature(clean, c.req.query("e"), c.req.query("s")))) throw notFound();
  try {
    const bytes = await readFile(localPath(clean));
    return c.body(bytes, 200, { "content-type": contentType(clean), "cache-control": "private, max-age=3600" });
  } catch {
    throw notFound();
  }
});

function contentType(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm",
    m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
  };
  return types[extension ?? ""] ?? "application/octet-stream";
}
