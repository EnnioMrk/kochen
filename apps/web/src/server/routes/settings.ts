import { Hono } from "hono";
import { DEFAULT_LIMITS, Limits } from "@kochen/contracts";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { forbidden, invalid, ok } from "../errors";
import type { AppEnv } from "../types";
import { body } from "../validate";

export const settings = new Hono<AppEnv>();
settings.use("*", requireUser);

settings.get("/", async (c) => {
  const sql = db();
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from app_settings where key in ('limits','features')
  `;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const limits = Limits.safeParse(byKey.get("limits") ?? DEFAULT_LIMITS);
  return ok(c, {
    limits: limits.success ? limits.data : DEFAULT_LIMITS,
    features: (byKey.get("features") as Record<string, boolean> | undefined) ?? { ai: true, video: true },
    appOrigin: "https://rezepte.ennio.vip",
  });
});

settings.patch("/limits", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin" && user.role !== "owner") throw forbidden();
  const input = await body(c, Limits.partial());
  const sql = db();
  const rows = await sql<{ value: unknown }[]>`select value from app_settings where key = 'limits'`;
  const merged = Limits.parse({ ...DEFAULT_LIMITS, ...(rows[0]?.value as object ?? {}), ...input });
  await sql`
    insert into app_settings (key, value) values ('limits', ${sql.json(merged as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  if (merged.maxPhotos <= 0) throw invalid("maxPhotos");
  return ok(c, merged);
});

void DEFAULT_LIMITS;
