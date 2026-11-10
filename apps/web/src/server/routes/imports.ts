import { Hono } from "hono";
import { z } from "zod";
import { DEFAULT_LIMITS, ImportInput, Limits, PresignInput, RecipeInput } from "@kochen/contracts";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { forbidden, invalid, limitExceeded, notFound, ok } from "../errors";
import { presignPut, mediaKey, signedGet, deleteObject } from "../media";
import { createRecipe } from "../recipe-write";
import { requireVisible } from "../repo";
import { toSummary } from "../serializers";
import { requireRecipeRow } from "../repo";
import type { AppEnv } from "../types";
import { body, idParam } from "../validate";

export const imports = new Hono<AppEnv>();
imports.use("*", requireUser);

const MB = 1024 * 1024;

export async function currentLimits(): Promise<Limits> {
  const sql = db();
  const rows = await sql<{ value: unknown }[]>`select value from app_settings where key = 'limits'`;
  const parsed = Limits.safeParse(rows[0]?.value ?? DEFAULT_LIMITS);
  return parsed.success ? parsed.data : DEFAULT_LIMITS;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"];
const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/wav", "audio/webm", "video/mp4", "video/quicktime", "video/webm"];

/** Types a browser reports when it does not know the real type. */
const GENERIC_TYPES = ["", "application/octet-stream", "binary/octet-stream", "application/x-unknown"];

/** Extension to MIME type, used when the browser sends no usable type. */
const EXTENSION_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", gif: "image/gif", pdf: "application/pdf",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
};

/**
 * The type the browser declares is often "image/jpg" or generic. Sign and
 * check the same type the file really has.
 */
function normalizeContentType(contentType: string, filename: string): string {
  const declared = contentType.trim().toLowerCase();
  const normalized = declared === "image/jpg" || declared === "image/pjpeg" ? "image/jpeg" : declared;
  if (!GENERIC_TYPES.includes(normalized)) return normalized;
  const extension = /\.([a-zA-Z0-9]{1,8})$/.exec(filename.trim())?.[1]?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

imports.get("/limits", async (c) => ok(c, await currentLimits()));

imports.post("/uploads/presign", async (c) => {
  const user = c.get("user");
  const input = await body(c, PresignInput);
  const limits = await currentLimits();

  if (input.kind === "photo" && input.files.length > limits.maxPhotos) {
    throw limitExceeded({ limit: "maxPhotos", allowed: limits.maxPhotos, actual: input.files.length });
  }
  const total = input.files.reduce((sum, file) => sum + file.size, 0);
  if (total > limits.maxTotalMb * MB) {
    throw limitExceeded({ limit: "maxTotalMb", allowed: limits.maxTotalMb, actual: Math.ceil(total / MB) });
  }
  for (const file of input.files) {
    if (file.size > limits.maxPhotoMb * MB) {
      throw limitExceeded({ limit: "maxPhotoMb", allowed: limits.maxPhotoMb, actual: Math.ceil(file.size / MB) });
    }
    const contentType = normalizeContentType(file.contentType, file.filename);
    if (input.kind === "photo" && !IMAGE_TYPES.includes(contentType)) {
      throw invalid(`unsupported_type:${contentType}`);
    }
    if ((input.kind === "video" || input.kind === "audio") && !AUDIO_TYPES.includes(contentType)) {
      throw invalid(`unsupported_type:${contentType}`);
    }
    if (input.kind === "pdf" && contentType !== "application/pdf") {
      throw invalid(`unsupported_type:${contentType}`);
    }
  }

  const files = await Promise.all(
    input.files.map(async (file) => {
      const key = mediaKey(`imports/${user.id}/${input.kind}`, file.filename);
      const contentType = normalizeContentType(file.contentType, file.filename);
      const uploadUrl = await presignPut(key, contentType, file.size);
      return { key, uploadUrl, headers: { "content-type": contentType } };
    }),
  );
  return ok(c, { files });
});

imports.post("/", async (c) => {
  const user = c.get("user");
  const input = await body(c, ImportInput);
  const limits = await currentLimits();
  const sql = db();

  if (input.kind === "link") {
    if (!input.url) throw invalid("url_missing");
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw invalid("url_invalid");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw invalid("scheme_not_allowed");
  }
  if (input.kind === "text" && !input.text?.trim()) throw invalid("text_missing");
  const needsFile = input.kind === "photo" || input.kind === "pdf" || input.kind === "audio";
  if (needsFile && input.keys.length === 0) throw invalid("files_missing");
  if (input.kind === "video" && input.keys.length === 0 && !input.url) throw invalid("files_missing");
  if (input.kind === "photo" && input.keys.length > limits.maxPhotos) {
    throw limitExceeded({ limit: "maxPhotos", allowed: limits.maxPhotos, actual: input.keys.length });
  }

  const rows = await sql<{ id: string; createdAt: Date }[]>`
    insert into jobs (user_id, kind, payload, state)
    values (${user.id}, ${`import_${input.kind}`},
            ${sql.json({
              kind: input.kind,
              text: input.text ?? null,
              url: input.url ?? null,
              keys: input.keys,
            } as never)}, 'queued')
    returning id, created_at as "createdAt"
  `;
  const job = rows[0];
  if (!job) throw new Error("job_insert_failed");
  return ok(c, { id: job.id, kind: input.kind, state: "queued", position: 0, createdAt: job.createdAt.toISOString() }, 202);
});

imports.get("/:id", async (c) => {
  const user = c.get("user");
  const id = idParam(c);
  const sql = db();
  const rows = await sql<
    {
      id: string;
      kind: string;
      state: string;
      payload: Record<string, unknown>;
      errorCode: string | null;
      errorMessage: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  >`
    select id, kind, state, payload, error_code as "errorCode", last_error as "errorMessage",
           created_at as "createdAt", updated_at as "updatedAt"
    from jobs where id = ${id} and user_id = ${user.id}
  `;
  const job = rows[0];
  if (!job) throw notFound();
  const earlier = await sql<{ count: number }[]>`
    select count(*)::int as count from jobs
    where user_id = ${user.id} and created_at < ${job.createdAt}
      and state in ('queued','fetching','normalizing','understanding')
  `;
  const payload = job.payload as {
    draft?: unknown;
    warnings?: unknown;
    asksForScreenshot?: unknown;
    sourceLang?: unknown;
    servingsEstimated?: unknown;
    keys?: string[];
  };
  return ok(c, {
    id: job.id,
    kind: (job.kind.replace("import_", "") as never),
    state: job.state,
    position: job.state === "queued" ? (earlier[0]?.count ?? 0) : null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    draft: payload.draft ?? null,
    draftMeta: payload.draft
      ? {
          warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
          asksForScreenshot: Boolean(payload.asksForScreenshot),
          sourceLang: typeof payload.sourceLang === "string" ? payload.sourceLang : null,
          servingsEstimated: Boolean(payload.servingsEstimated),
        }
      : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
});

imports.post("/:id/confirm", async (c) => {
  const user = c.get("user");
  const id = idParam(c);
  const input = await body(c, RecipeInput);
  const sql = db();
  const rows = await sql<{ payload: { keys?: string[] }; state: string }[]>`
    select payload, state from jobs where id = ${id} and user_id = ${user.id}
  `;
  const job = rows[0];
  if (!job) throw notFound();
  if (job.state === "done") throw invalid("already_confirmed");

  const recipeId = await createRecipe(user.id, input, job.payload.keys ?? []);
  await sql`update jobs set state = 'done', payload = payload || ${sql.json({ recipeId } as never)} where id = ${id}`;
  const row = await requireRecipeRow(recipeId);
  const summary = toSummary(row);
  return ok(c, { recipeId, recipe: summary }, 201);
});

imports.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = idParam(c);
  const sql = db();
  const rows = await sql<{ payload: { keys?: string[] } }[]>`
    select payload from jobs where id = ${id} and user_id = ${user.id}
  `;
  const job = rows[0];
  if (!job) throw notFound();
  await Promise.all((job.payload.keys ?? []).map((key) => deleteObject(key)));
  await sql`update jobs set state = 'failed', error_code = 'cancelled' where id = ${id}`;
  return ok(c, { cancelled: true });
});

/* Generic job status: export PDF and other one-off jobs. */
export const jobs = new Hono<AppEnv>();
jobs.use("*", requireUser);

jobs.get("/:id", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<
    { id: string; kind: string; state: string; errorCode: string | null; payload: { resultKey?: string }; progress: number }[]
  >`
    select id, kind, state, error_code as "errorCode", payload, progress
    from jobs where id = ${idParam(c)} and user_id = ${user.id}
  `;
  const job = rows[0];
  if (!job) throw notFound();
  const url = job.payload?.resultKey ? await signedGet(job.payload.resultKey) : null;
  return ok(c, {
    id: job.id,
    kind: job.kind,
    state: job.state,
    progress: job.progress,
    errorCode: job.errorCode,
    url,
  });
});

/* ------------------------------------------------------------ dev fallback */
import { env } from "../env";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const devDir = "/tmp/opencode/kochen-media";

export const devMedia = new Hono();

devMedia.put("/dev-upload/:key{.+}", async (c) => {
  if (env.r2Configured) throw forbidden();
  const key = decodeURIComponent(c.req.param("key") ?? "");
  if (!key || key.includes("..")) throw invalid("bad_key");
  const target = join(devDir, key.replace(/\//g, "_"));
  await mkdir(devDir, { recursive: true });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  await writeFile(target, bytes);
  return ok(c, { stored: true });
});

devMedia.get("/dev-media/:key{.+}", async (c) => {
  if (env.r2Configured) throw forbidden();
  const key = decodeURIComponent(c.req.param("key") ?? "");
  if (!key || key.includes("..")) throw invalid("bad_key");
  try {
    const bytes = await readFile(join(devDir, key.replace(/\//g, "_")));
    c.header("content-type", "application/octet-stream");
    return c.body(bytes);
  } catch {
    throw notFound();
  }
});

void unlink;
