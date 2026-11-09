import { Hono } from "hono";
import { z } from "zod";
import { CategoryInput } from "@kochen/contracts";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { conflict, forbidden, notFound, ok } from "../errors";
import { friendIdsOf, requireVisible } from "../repo";
import { slugifyTag } from "../tags-lib";
import type { AppEnv } from "../types";
import { body, idParam } from "../validate";

export const tags = new Hono<AppEnv>();
tags.use("*", requireUser);

tags.get("/tags", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const sql = db();
  const rows = q
    ? await sql<{ slug: string; label: string; usage: number }[]>`
        select t.slug, t.label, count(rt.recipe_id)::int as usage
        from tags t left join recipe_tags rt on rt.tag_id = t.id
        where t.slug like ${`%${q}%`} or t.label ilike ${`%${q}%`} or similarity(t.label, ${q}) > 0.35
        group by t.id order by usage desc, t.label limit 50
      `
    : await sql<{ slug: string; label: string; usage: number }[]>`
        select t.slug, t.label, count(rt.recipe_id)::int as usage
        from tags t left join recipe_tags rt on rt.tag_id = t.id
        group by t.id order by usage desc, t.label limit 200
      `;
  return ok(c, rows);
});

tags.post("/tags", async (c) => {
  const input = await body(c, z.object({ name: z.string().min(1).max(60) }));
  const sql = db();
  const slug = slugifyTag(input.name);
  if (!slug) throw conflict("Tag ist leer.");
  const rows = await sql<{ slug: string; label: string }[]>`
    insert into tags (slug, label) values (${slug}, ${input.name.trim()})
    on conflict (slug) do update set label = tags.label
    returning slug, label
  `;
  return ok(c, rows[0], 201);
});

tags.get("/categories", async (c) => {
  const user = c.get("user");
  const friends = await friendIdsOf(user.id);
  const sql = db();
  const rows = await sql<{ id: string; name: string; ownerId: string; recipeCount: number }[]>`
    select c.id, c.name, c.owner_id as "ownerId", count(rc.recipe_id)::int as "recipeCount"
    from categories c
    left join recipe_categories rc on rc.category_id = c.id
    where c.owner_id = ${user.id} or c.owner_id = any(${friends}::uuid[])
    group by c.id
    order by c.name
  `;
  return ok(c, rows);
});

tags.post("/categories", async (c) => {
  const user = c.get("user");
  const input = await body(c, CategoryInput);
  const sql = db();
  const rows = await sql<{ id: string; name: string }[]>`
    insert into categories (owner_id, name) values (${user.id}, ${input.name.trim()})
    on conflict do nothing
    returning id, name
  `;
  if (!rows[0]) throw conflict("Diese Kategorie gibt es schon.");
  return ok(c, rows[0], 201);
});

tags.patch("/categories/:id", async (c) => {
  const user = c.get("user");
  const input = await body(c, CategoryInput);
  const sql = db();
  const rows = await sql<{ id: string; name: string }[]>`
    update categories set name = ${input.name.trim()}
    where id = ${idParam(c)} and owner_id = ${user.id}
    returning id, name
  `;
  if (!rows[0]) throw notFound();
  return ok(c, rows[0]);
});

tags.delete("/categories/:id", async (c) => {
  const user = c.get("user");
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    delete from categories where id = ${idParam(c)} and owner_id = ${user.id} returning id
  `;
  if (!rows[0]) throw forbidden();
  return ok(c, { deleted: true });
});

/* Set tags on a recipe. The member confirms every tag here. */
tags.put("/recipes/:id/tags", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c));
  if (row.ownerId !== user.id) {
    const access = await requireVisible(user.id, row.id);
    if (!access.access.edit) throw forbidden();
  }
  const input = await body(c, z.object({ names: z.array(z.string().max(60)).max(30) }));
  const { attachTags } = await import("../tags-lib");
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`delete from recipe_tags where recipe_id = ${row.id}`;
    await attachTags(tx as never, row.id, input.names, user.id);
  });
  return ok(c, { updated: true });
});
