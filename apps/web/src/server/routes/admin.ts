import { Hono } from "hono";
import {
  PLATFORMS,
  PlatformCredential,
  PlatformCredentialInput,
  PlatformName,
  PlatformTestResult,
} from "@kochen/contracts";
import { sealSecret } from "@kochen/core";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { forbidden, invalid, notFound, ok } from "../errors";
import { body, idParam } from "../validate";
import type { AppEnv } from "../types";

export const admin = new Hono<AppEnv>();
admin.use("*", requireUser);

function requireAdmin(role: string): void {
  if (role !== "admin" && role !== "owner") throw forbidden();
}

type CredentialRow = {
  platform: string;
  username: string | null;
  passwordEnc: string | null;
  cookiesEnc: string | null;
  updatedAt: Date;
  updatedByName: string | null;
};

function toPublic(row: CredentialRow): PlatformCredential {
  return {
    platform: PlatformName.parse(row.platform),
    username: row.username,
    hasPassword: Boolean(row.passwordEnc),
    hasCookies: Boolean(row.cookiesEnc),
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

/** Every platform, also the ones without a row, so the form always renders. */admin.get("/platforms", async (c) => {
  const user = c.get("user");
  requireAdmin(user.role);
  const sql = db();
  const rows = await sql<CredentialRow[]>`
    select p.platform,
           p.username,
           p.password_enc as "passwordEnc",
           p.cookies_enc as "cookiesEnc",
           p.updated_at as "updatedAt",
           u.name as "updatedByName"
    from platform_credentials p
    left join users u on u.id = p.updated_by
  `;
  const byPlatform = new Map(rows.map((row) => [row.platform, toPublic(row)]));
  return ok(
    c,
    PLATFORMS.map(
      (platform) =>
        byPlatform.get(platform) ?? {
          platform,
          username: null,
          hasPassword: false,
          hasCookies: false,
          updatedAt: new Date(0).toISOString(),
          updatedByName: null,
        },
    ),
  );
});

admin.put("/platforms/:platform", async (c) => {
  const user = c.get("user");
  requireAdmin(user.role);
  const platform = PLATFORMS.find((name) => name === c.req.param("platform"));
  if (!platform) throw invalid("platform");
  const input = await body(c, PlatformCredentialInput);
  const sql = db();

  const [existing] = await sql<{ username: string | null; passwordEnc: string | null; cookiesEnc: string | null }[]>`
    select username, password_enc as "passwordEnc", cookies_enc as "cookiesEnc"
    from platform_credentials where platform = ${platform}
  `;

  const username =
    input.username !== undefined ? input.username?.trim() || null : existing?.username ?? null;
  const passwordEnc =
    input.password !== undefined
      ? input.password
        ? await sealSecret(input.password)
        : null
      : existing?.passwordEnc ?? null;
  const cookiesEnc =
    input.cookies !== undefined
      ? input.cookies
        ? await sealSecret(input.cookies)
        : null
      : existing?.cookiesEnc ?? null;

  await sql`
    insert into platform_credentials (platform, username, password_enc, cookies_enc, updated_by, updated_at)
    values (${platform}, ${username}, ${passwordEnc}, ${cookiesEnc}, ${user.id}, now())
    on conflict (platform) do update
      set username = excluded.username,
          password_enc = excluded.password_enc,
          cookies_enc = excluded.cookies_enc,
          updated_by = excluded.updated_by,
          updated_at = now()
  `;

  return ok(c, {
    platform,
    username,
    hasPassword: Boolean(passwordEnc),
    hasCookies: Boolean(cookiesEnc),
    updatedAt: new Date().toISOString(),
    updatedByName: user.name,
  } satisfies PlatformCredential);
});

admin.delete("/platforms/:platform", async (c) => {
  const user = c.get("user");
  requireAdmin(user.role);
  const platform = PLATFORMS.find((name) => name === c.req.param("platform"));
  if (!platform) throw invalid("platform");
  const sql = db();
  await sql`delete from platform_credentials where platform = ${platform}`;
  return ok(c, { deleted: true });
});

/**
 * A login test runs in the worker: only that image has yt-dlp. The job reads
 * one stable public item with the stored cookies, so the answer is real.
 */
admin.post("/platforms/:platform/test", async (c) => {
  const user = c.get("user");
  requireAdmin(user.role);
  const platform = PLATFORMS.find((name) => name === c.req.param("platform"));
  if (!platform) throw invalid("platform");
  const sql = db();

  const [running] = await sql<{ id: string }[]>`
    select id from jobs
    where user_id = ${user.id}
      and kind = 'platform_test'
      and state in ('queued', 'fetching', 'normalizing', 'understanding')
      and payload->>'platform' = ${platform}
    order by created_at desc
    limit 1
  `;
  if (running) return ok(c, { jobId: running.id });

  const rows = await sql<{ id: string }[]>`
    insert into jobs (user_id, kind, payload)
    values (${user.id}, 'platform_test', ${sql.json({ platform } as never)})
    returning id
  `;
  const created = rows[0];
  if (!created) throw new Error("test_job_failed");
  return ok(c, { jobId: created.id }, 202);
});

admin.get("/tests/:jobId", async (c) => {
  const user = c.get("user");
  requireAdmin(user.role);
  const sql = db();
  const rows = await sql<
    { state: string; payload: { result?: unknown }; lastError: string | null }[]
  >`
    select state, payload, last_error as "lastError"
    from jobs
    where id = ${idParam(c, "jobId")} and user_id = ${user.id} and kind = 'platform_test'
  `;
  const job = rows[0];
  if (!job) throw notFound();
  const parsed = PlatformTestResult.safeParse(job.payload?.result);
  return ok(c, {
    jobId: c.req.param("jobId"),
    state: job.state,
    running: !["done", "failed"].includes(job.state),
    result: parsed.success ? parsed.data : null,
    message: job.lastError,
  });
});
