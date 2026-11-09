import { Hono } from "hono";
import { z } from "zod";
import { PushSubscriptionInput, TimerInput } from "@kochen/contracts";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { env } from "../env";
import { invalid, notFound, ok } from "../errors";
import { requireVisible } from "../repo";
import type { AppEnv } from "../types";
import { body, idParam } from "../validate";

export const notifications = new Hono<AppEnv>();
notifications.use("*", requireUser);

notifications.get("/notifications", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<
    { id: string; kind: string; payload: Record<string, unknown>; readAt: Date | null; createdAt: Date }[]
  >`
    select id, kind, payload, read_at as "readAt", created_at as "createdAt"
    from notifications where user_id = ${user.id}
    order by created_at desc limit 100
  `;
  return ok(c, rows.map((row) => ({ ...row, readAt: row.readAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })));
});

notifications.post("/notifications/:id/read", async (c) => {
  const user = c.get("user");
  const sql = db();
  await sql`update notifications set read_at = now() where id = ${idParam(c)} and user_id = ${user.id}`;
  return ok(c, { read: true });
});

notifications.post("/notifications/read-all", async (c) => {
  const user = c.get("user");
  const sql = db();
  await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
  return ok(c, { read: true });
});

/* ------------------------------------------------------------------- push */

notifications.get("/push/key", async (c) => {
  return ok(c, { publicKey: env.vapid.publicKey, enabled: Boolean(env.vapid.publicKey) });
});

notifications.post("/push/subscribe", async (c) => {
  const user = c.get("user");
  const input = await body(c, PushSubscriptionInput);
  const sql = db();
  await sql`
    insert into push_subscriptions (user_id, endpoint, keys, ua)
    values (${user.id}, ${input.endpoint}, ${sql.json(input.keys as never)}, ${c.req.header("user-agent") ?? null})
    on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, failed_at = null
  `;
  return ok(c, { subscribed: true });
});

notifications.delete("/push/subscribe", async (c) => {
  const user = c.get("user");
  const input = await body(c, z.object({ endpoint: z.string().url() }));
  const sql = db();
  await sql`delete from push_subscriptions where user_id = ${user.id} and endpoint = ${input.endpoint}`;
  return ok(c, { unsubscribed: true });
});

notifications.patch("/push/setting", async (c) => {
  const user = c.get("user");
  const input = await body(c, z.object({ enabled: z.boolean() }));
  const sql = db();
  await sql`
    insert into app_settings (key, value) values (${`user:${user.id}`}, ${sql.json({ push: input.enabled } as never)})
    on conflict (key) do update set value = app_settings.value || ${sql.json({ push: input.enabled } as never)}
  `;
  return ok(c, { enabled: input.enabled });
});

/* ----------------------------------------------------------------- timers */

notifications.post("/timers", async (c) => {
  const user = c.get("user");
  const input = await body(c, TimerInput.extend({ recipeId: z.string().uuid() }));
  const { row } = await requireVisible(user.id, input.recipeId);
  if (input.seconds > 24 * 3600) throw invalid("timer_too_long");
  const endsAt = new Date(Date.now() + input.seconds * 1000);
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into timers (user_id, recipe_id, step_id, ends_at)
    values (${user.id}, ${row.id}, ${input.stepId}, ${endsAt})
    returning id
  `;
  const timer = rows[0];
  if (!timer) throw new Error("timer_failed");
  await sql`
    insert into jobs (user_id, kind, payload, run_at)
    values (${user.id}, 'timer', ${sql.json({ timerId: timer.id } as never)}, ${endsAt})
  `;
  return ok(c, { id: timer.id, stepId: input.stepId, endsAt: endsAt.toISOString(), notifiedAt: null }, 201);
});

notifications.get("/timers", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<
    { id: string; stepId: string; endsAt: Date; notifiedAt: Date | null; recipeId: string }[]
  >`
    select id, step_id as "stepId", ends_at as "endsAt", notified_at as "notifiedAt", recipe_id as "recipeId"
    from timers where user_id = ${user.id} and ends_at > now() - interval '10 minutes'
    order by ends_at
  `;
  return ok(c, rows.map((row) => ({
    ...row,
    endsAt: row.endsAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
  })));
});

notifications.delete("/timers/:id", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    delete from timers where id = ${idParam(c)} and user_id = ${user.id} returning id
  `;
  if (!rows[0]) throw notFound();
  return ok(c, { cancelled: true });
});
