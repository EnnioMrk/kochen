import { Hono } from "hono";
import { z } from "zod";
import { RecipeInput, ForkInput, CommentInput, Visibility, type Stars } from "@kochen/contracts";
import { assertRating, canRate, diffLines, INGREDIENT_DIFF_FIELDS, STEP_DIFF_FIELDS, scaleAmount } from "@kochen/core";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { ApiError, conflict, forbidden, invalid, notFound, ok } from "../errors";
import { randomToken, sha256hex } from "../crypto";
import { notify } from "../notify";
import {
  RECIPE_SELECT,
  commentsFor,
  detailFor,
  friendIdsOf,
  mapFlat,
  requireRecipeRow,
  requireVisible,
  toSummaries,
  type FlatRecipe,
} from "../repo";

import { attachCategories, attachTags } from "../tags-lib";
import { createRecipe, bakingText, writeLines } from "../recipe-write";
import type { AppEnv } from "../types";
import { body, idParam, linkToken, query } from "../validate";

export const recipes = new Hono<AppEnv>();
recipes.use("*", requireUser);

const ListQuery = z.object({
  scope: z.enum(["mine", "friends", "all", "variations"]).default("mine"),
  tags: z.string().optional(),
  archived: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(),
});

const PatchInput = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  servings: z.number().int().min(1).max(100).optional(),
  bakingTemperature: z.string().max(80).nullable().optional(),
  bakingTime: z.string().max(80).nullable().optional(),
  ingredients: z.array(RecipeInput.shape.ingredients.element).optional(),
  steps: z.array(RecipeInput.shape.steps.element).optional(),
  visibility: Visibility.optional(),
  tagNames: z.array(z.string().max(60)).max(30).optional(),
  categoryIds: z.array(z.string().uuid()).max(20).optional(),
  sourceUrl: z.string().url().nullable().optional(),
  rawText: z.string().max(200_000).nullable().optional(),
  transcript: z.string().max(200_000).nullable().optional(),
  originalLang: z.string().max(16).nullable().optional(),
});

const ImageInput = z.object({
  key: z.string().min(1).max(500),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  kind: z.enum(["cover", "step", "original"]).default("cover"),
  position: z.number().int().nonnegative().default(0),
});

recipes.get("/", async (c) => {
  const user = c.get("user");
  const q = query(c, ListQuery);
  const sql = db();
  const friends = await friendIdsOf(user.id);
  const params: unknown[] = [];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const where: string[] = ["r.deleted_at is null"];
  where.push(q.archived === "true" ? "r.archived_at is not null" : "r.archived_at is null");

  if (q.scope === "mine") {
    where.push(`r.owner_id = ${p(user.id)}::uuid`);
  } else if (q.scope === "friends") {
    where.push(`r.owner_id = any(${p(friends)}::uuid[]) and r.visibility <> 'private'`);
  } else if (q.scope === "variations") {
    where.push(
      `r.parent_id is not null and (r.owner_id = ${p(user.id)}::uuid or (r.owner_id = any(${p(friends)}::uuid[]) and r.visibility <> 'private'))`,
    );
  } else {
    const visibleFriends = friends.length > 0
      ? `r.owner_id = any(${p(friends)}::uuid[])`
      : "false";
    where.push(
      `(r.owner_id = ${p(user.id)}::uuid or (r.visibility <> 'private' and (${visibleFriends} or r.visibility = 'members')))`,
    );
  }

  const tags = (q.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
  for (const tag of tags) {
    where.push(
      `exists (select 1 from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = r.id and t.slug = ${p(tag)})`,
    );
  }
  if (q.before) where.push(`r.created_at < ${p(q.before)}::timestamptz`);

  const text = `${RECIPE_SELECT} where ${where.join(" and ")} order by r.updated_at desc limit ${p(q.limit)}`;
  const rows = await sql.unsafe<FlatRecipe[]>(text, params);
  const summaries = await toSummaries(rows.map(mapFlat), user.id);
  return ok(c, { items: summaries });
});

recipes.post("/", async (c) => {
  const user = c.get("user");
  const input = await body(c, RecipeInput);
  const created = await createRecipe(user.id, input);
  const row = await requireRecipeRow(created);
  const access = { view: true, comment: true, edit: true, share: true };
  return ok(c, await detailFor(row, access, user.id), 201);
});

recipes.get("/:id", async (c) => {
  const user = c.get("user");
  const { row, access } = await requireVisible(user.id, idParam(c), linkToken(c));
  return ok(c, await detailFor(row, access, user.id));
});

recipes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = idParam(c);
  const { row, access } = await requireVisible(user.id, id);
  if (!access.edit) throw forbidden();
  const patch = await body(c, PatchInput);
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`
      update recipes set
        title = coalesce(${patch.title ?? null}, title),
        description = ${patch.description === undefined ? row.description : patch.description},
        servings = coalesce(${patch.servings ?? null}, servings),
        baking_temperature = ${patch.bakingTemperature === undefined ? row.bakingTemperature : bakingText(patch.bakingTemperature)},
        baking_time = ${patch.bakingTime === undefined ? row.bakingTime : bakingText(patch.bakingTime)},
        visibility = coalesce(${patch.visibility ?? null}, visibility),
        source_url = ${patch.sourceUrl === undefined ? row.sourceUrl : patch.sourceUrl},
        raw_text = ${patch.rawText === undefined ? row.rawText : patch.rawText},
        transcript = ${patch.transcript === undefined ? row.transcript : patch.transcript},
        original_lang = ${patch.originalLang === undefined ? row.originalLang : patch.originalLang}
      where id = ${id}
    `;
    if (patch.ingredients || patch.steps) {
      const currentIngredients = patch.ingredients ?? [];
      const currentSteps = patch.steps ?? [];
      await writeLines(tx, id, currentIngredients, currentSteps);
    }
    if (patch.tagNames) {
      await tx`delete from recipe_tags where recipe_id = ${id}`;
      await attachTags(tx as never, id, patch.tagNames, user.id);
    }
    if (patch.categoryIds) {
      await tx`delete from recipe_categories where recipe_id = ${id}`;
      await attachCategories(tx as never, id, patch.categoryIds, user.id);
    }
  });
  const fresh = await requireRecipeRow(id);
  return ok(c, await detailFor(fresh, access, user.id));
});

recipes.post("/:id/archive", async (c) => {
  const user = c.get("user");
  const { row, access } = await requireVisible(user.id, idParam(c));
  if (!access.edit) throw forbidden();
  const sql = db();
  await sql`update recipes set archived_at = now() where id = ${row.id}`;
  const fresh = await requireRecipeRow(row.id);
  return ok(c, await detailFor(fresh, access, user.id));
});

recipes.post("/:id/restore", async (c) => {
  const user = c.get("user");
  const row = await requireRecipeRow(idParam(c));
  if (row.ownerId !== user.id) throw forbidden();
  const sql = db();
  await sql`update recipes set archived_at = null, deleted_at = null where id = ${row.id}`;
  const fresh = await requireRecipeRow(row.id);
  return ok(c, await detailFor(fresh, { view: true, comment: true, edit: true, share: true }, user.id));
});

recipes.delete("/:id", async (c) => {
  const user = c.get("user");
  const row = await requireRecipeRow(idParam(c));
  if (row.ownerId !== user.id) throw forbidden();
  const sql = db();
  // Soft delete. Variations stay readable and show the deleted original marker.
  await sql`update recipes set deleted_at = now(), archived_at = now() where id = ${row.id}`;
  return ok(c, { deleted: true });
});

recipes.post("/:id/images", async (c) => {
  const user = c.get("user");
  const { row, access } = await requireVisible(user.id, idParam(c));
  if (!access.edit) throw forbidden();
  const input = await body(c, ImageInput);
  const sql = db();
  // A new cover wins: every older cover moves one step back.
  if (input.kind === "cover") {
    await sql`
      update images set position = position + 1
      where recipe_id = ${row.id} and kind = 'cover'
    `;
  }
  await sql`
    insert into images (recipe_id, r2_key, width, height, kind, position)
    values (${row.id}, ${input.key}, ${input.width ?? null}, ${input.height ?? null}, ${input.kind}, ${input.position})
  `;
  return ok(c, { attached: true });
});

recipes.post("/:id/cook", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c));
  const sql = db();
  await sql`insert into cook_events (user_id, recipe_id) values (${user.id}, ${row.id})`;
  const status = await sql<{ count: number; lastCookedAt: Date | null }[]>`
    select count(*)::int as count, max(cooked_at) as "lastCookedAt"
    from cook_events where user_id = ${user.id} and recipe_id = ${row.id}
  `;
  return ok(c, {
    state: "cooked" as const,
    count: status[0]?.count ?? 1,
    lastCookedAt: status[0]?.lastCookedAt?.toISOString() ?? new Date().toISOString(),
  });
});

recipes.post("/:id/rating", async (c) => {
  const user = c.get("user");
  const { row, access } = await requireVisible(user.id, idParam(c));
  if (!access.view) throw forbidden();
  const input = await body(c, z.object({ stars: z.number() }));
  const sql = db();
  const cooked = await sql<{ count: number }[]>`
    select count(*)::int as count from cook_events
    where user_id = ${user.id} and recipe_id = ${row.id}
  `;
  const cookCount = cooked[0]?.count ?? 0;
  if (!canRate(cookCount)) {
    throw new ApiError("forbidden", 403, "Bewerten ist erst nach dem Kochen möglich.");
  }
  try {
    assertRating(cookCount, input.stars);
  } catch {
    throw invalid("invalid_stars");
  }
  await sql`
    insert into ratings (user_id, recipe_id, stars)
    values (${user.id}, ${row.id}, ${input.stars})
    on conflict (user_id, recipe_id)
    do update set stars = excluded.stars, updated_at = now()
  `;
  const summary = await sql<{ avg: number | null; count: number }[]>`
    select avg(stars)::float8 as avg, count(*)::int as count from ratings where recipe_id = ${row.id}
  `;
  return ok(c, {
    myRating: input.stars as Stars,
    avgRating: summary[0]?.avg ?? null,
    ratingCount: summary[0]?.count ?? 0,
  });
});

recipes.post("/:id/fork", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c));
  const input = await body(c, ForkInput);
  const sql = db();
  const sourceIngredients = await sql<
    { amount: string | null; unitKey: string | null; name: string; note: string | null; lineageKey: string }[]
  >`
    select amount, unit_key as "unitKey", name, note, lineage_key as "lineageKey"
    from recipe_ingredients where recipe_id = ${row.id} order by position
  `;
  const sourceSteps = await sql<{ text: string; durationS: number | null; lineageKey: string }[]>`
    select text, duration_s as "durationS", lineage_key as "lineageKey"
    from recipe_steps where recipe_id = ${row.id} order by position
  `;

  const targetServings = input.servings ?? row.servings;
  const factor = row.servings > 0 ? targetServings / row.servings : 1;
  const ingredients = (input.ingredients ?? sourceIngredients.map((item) => ({
    amount:
      item.amount === null
        ? null
        : scaleAmount(Number(item.amount), item.unitKey, factor),
    unit: item.unitKey as never,
    name: item.name,
    note: item.note,
    lineageKey: item.lineageKey,
  })));
  const steps = (input.steps ?? sourceSteps.map((item) => ({
    text: item.text,
    durationS: item.durationS,
    lineageKey: item.lineageKey,
  })));

  const newId = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into recipes (owner_id, title, description, servings, baking_temperature, baking_time,
                           source_type, source_url, raw_text, transcript, original_lang, visibility, parent_id)
      values (${user.id}, ${input.title ?? row.title}, ${row.description}, ${targetServings},
              ${row.bakingTemperature}, ${row.bakingTime},
              ${row.sourceType}, ${row.sourceUrl}, ${row.rawText}, ${row.transcript},
              ${row.originalLang}, ${row.visibility}, ${row.id})
      returning id
    `;
    const created = rows[0];
    if (!created) throw new Error("fork_failed");
    await writeLines(
      tx as never,
      created.id,
      ingredients.map((item) => ({
        amount: item.amount ?? null,
        unit: item.unit ?? null,
        name: item.name,
        note: item.note ?? null,
        lineageKey: "lineageKey" in item ? item.lineageKey : undefined,
      })),
      steps.map((item) => ({
        text: item.text,
        durationS: item.durationS ?? null,
        lineageKey: "lineageKey" in item ? item.lineageKey : undefined,
      })),
    );
    const tagRows = await tx<{ slug: string }[]>`
      select t.slug from recipe_tags rt join tags t on t.id = rt.tag_id where rt.recipe_id = ${row.id}
    `;
    await attachTags(tx as never, created.id, tagRows.map((tag) => tag.slug), user.id);
    const categoryRows = await tx<{ id: string }[]>`
      select c.id from recipe_categories rc join categories c on c.id = rc.category_id
      where rc.recipe_id = ${row.id} and c.owner_id = ${user.id}
    `;
    await attachCategories(tx as never, created.id, categoryRows.map((category) => category.id), user.id);
    if (row.ownerId !== user.id) {
      await notify(tx as never, row.ownerId, "variation", {
        recipeId: created.id,
        title: input.title ?? row.title,
        from: user.name,
        originalId: row.id,
      }, `variation:${created.id}`);
    }
    return created.id;
  });

  const fresh = await requireRecipeRow(newId);
  return ok(c, await detailFor(fresh, { view: true, comment: true, edit: true, share: true }, user.id), 201);
});

recipes.get("/:id/diff", async (c) => {
  const user = c.get("user");
  const token = linkToken(c);
  const { row } = await requireVisible(user.id, idParam(c), token);
  if (!row.parentId) throw invalid("recipe_has_no_parent");
  const parent = await requireVisible(user.id, row.parentId, token);
  const sql = db();
  const [a, b] = await Promise.all([
    sql<{ position: number; amount: string | null; unitKey: string | null; name: string; note: string | null; lineageKey: string }[]>`
      select position, amount, unit_key as "unitKey", name, note, lineage_key as "lineageKey"
      from recipe_ingredients where recipe_id = ${parent.row.id} order by position
    `,
    sql<{ position: number; amount: string | null; unitKey: string | null; name: string; note: string | null; lineageKey: string }[]>`
      select position, amount, unit_key as "unitKey", name, note, lineage_key as "lineageKey"
      from recipe_ingredients where recipe_id = ${row.id} order by position
    `,
  ]);
  const [aSteps, bSteps] = await Promise.all([
    sql<{ position: number; text: string; durationS: number | null; lineageKey: string }[]>`
      select position, text, duration_s as "durationS", lineage_key as "lineageKey"
      from recipe_steps where recipe_id = ${parent.row.id} order by position
    `,
    sql<{ position: number; text: string; durationS: number | null; lineageKey: string }[]>`
      select position, text, duration_s as "durationS", lineage_key as "lineageKey"
      from recipe_steps where recipe_id = ${row.id} order by position
    `,
  ]);
  const toLine = (item: (typeof a)[number]) => ({
    lineageKey: item.lineageKey,
    amount: item.amount === null ? null : Number(item.amount),
    unit: item.unitKey,
    name: item.name,
    note: item.note,
    position: item.position,
  });
  return ok(c, {
    predecessorId: parent.row.id,
    variationId: row.id,
    predecessorChanged: Boolean(
      row.forkedAt && new Date(parent.row.updatedAt) > new Date(row.forkedAt),
    ),
    ingredients: diffLines(a.map(toLine), b.map(toLine), { fields: INGREDIENT_DIFF_FIELDS }),
    steps: diffLines(
      aSteps.map((item) => ({ ...item, lineageKey: item.lineageKey })),
      bSteps.map((item) => ({ ...item, lineageKey: item.lineageKey })),
      { fields: STEP_DIFF_FIELDS },
    ),
  });
});

/* ---------------------------------------------------------------- comments */

recipes.get("/:id/comments", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c), linkToken(c));
  return ok(c, await commentsFor(row.id));
});

recipes.post("/:id/comments", async (c) => {
  const user = c.get("user");
  const { row, access } = await requireVisible(user.id, idParam(c), linkToken(c));
  if (!access.comment) throw forbidden();
  const input = await body(c, CommentInput);
  const sql = db();
  const created = await sql.begin(async (tx) => {
    let rows;
    try {
      rows = await tx<{ id: string }[]>`
        insert into comments (recipe_id, author_id, parent_id, body)
        values (${row.id}, ${user.id}, ${input.parentId ?? null}, ${input.body.trim()})
        returning id
      `;
    } catch (error) {
      throw invalid((error as Error).message);
    }
    const comment = rows[0];
    if (!comment) throw new Error("comment_failed");
    if (input.parentId) {
      const parent = await tx<{ authorId: string }[]>`
        select author_id as "authorId" from comments where id = ${input.parentId}
      `;
      if (parent[0] && parent[0].authorId !== user.id) {
        await notify(tx as never, parent[0].authorId, "reply", {
          recipeId: row.id,
          recipeTitle: row.title,
          commentId: comment.id,
          from: user.name,
        }, `comment:${comment.id}`);
      }
    }
    if (row.ownerId !== user.id) {
      await notify(tx as never, row.ownerId, "comment", {
        recipeId: row.id,
        recipeTitle: row.title,
        commentId: comment.id,
        from: user.name,
      }, `comment-owner:${comment.id}`);
    }
    return comment.id;
  });
  const all = await commentsFor(row.id);
  return ok(c, { id: created, comments: all }, 201);
});

recipes.delete("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c));
  const sql = db();
  const rows = await sql<{ authorId: string }[]>`
    select author_id as "authorId" from comments where id = ${idParam(c, "commentId")} and recipe_id = ${row.id}
  `;
  const comment = rows[0];
  if (!comment) throw notFound();
  if (comment.authorId !== user.id && row.ownerId !== user.id) throw forbidden();
  await sql`update comments set deleted_at = now() where id = ${idParam(c, "commentId")}`;
  return ok(c, { deleted: true });
});

/** Undo of a soft delete. The body is kept, so the text comes back. */
recipes.post("/:id/comments/:commentId/restore", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c));
  const sql = db();
  const rows = await sql<{ authorId: string; deletedAt: Date | null }[]>`
    select author_id as "authorId", deleted_at as "deletedAt" from comments
    where id = ${idParam(c, "commentId")} and recipe_id = ${row.id}
  `;
  const comment = rows[0];
  if (!comment) throw notFound();
  if (comment.authorId !== user.id && row.ownerId !== user.id) throw forbidden();
  if (comment.deletedAt) {
    await sql`update comments set deleted_at = null where id = ${idParam(c, "commentId")}`;
  }
  return ok(c, { restored: true });
});

/* ----------------------------------------------------------- private links */

recipes.get("/:id/links", async (c) => {
  const user = c.get("user");
  const row = await requireRecipeRow(idParam(c));
  if (row.ownerId !== user.id) throw forbidden();
  const sql = db();
  const links = await sql<{ id: string; createdAt: Date; revokedAt: Date | null }[]>`
    select id, created_at as "createdAt", revoked_at as "revokedAt"
    from private_links where recipe_id = ${row.id} and revoked_at is null order by created_at desc
  `;
  return ok(c, links.map((link) => ({ ...link, url: null })));
});

recipes.post("/:id/links", async (c) => {
  const user = c.get("user");
  const row = await requireRecipeRow(idParam(c));
  if (row.ownerId !== user.id) throw forbidden();
  if (row.visibility === "private") throw conflict("Ein privates Rezept lässt sich nicht teilen.");
  const token = randomToken(32);
  const hash = await sha256hex(token);
  const sql = db();
  const rows = await sql<{ id: string; createdAt: Date }[]>`
    insert into private_links (recipe_id, token_hash, created_by)
    values (${row.id}, ${hash}, ${user.id}) returning id, created_at as "createdAt"
  `;
  const link = rows[0];
  if (!link) throw new Error("link_failed");
  return ok(
    c,
    {
      id: link.id,
      url: `https://rezepte.ennio.vip/r/${row.id}?link=${token}`,
      createdAt: link.createdAt.toISOString(),
      revokedAt: null,
    },
    201,
  );
});

recipes.delete("/:id/links/:linkId", async (c) => {
  const user = c.get("user");
  const row = await requireRecipeRow(idParam(c));
  if (row.ownerId !== user.id) throw forbidden();
  const sql = db();
  await sql`
    update private_links set revoked_at = now()
    where id = ${idParam(c, "linkId")} and recipe_id = ${row.id}
  `;
  return ok(c, { revoked: true });
});

/* ----------------------------------------------------------------- export */

recipes.get("/:id/export.md", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c), linkToken(c));
  const sql = db();
  const ingredients = await sql<{ amount: string | null; unitKey: string | null; name: string; note: string | null }[]>`
    select amount, unit_key as "unitKey", name, note from recipe_ingredients
    where recipe_id = ${row.id} order by position
  `;
  const steps = await sql<{ text: string }[]>`
    select text from recipe_steps where recipe_id = ${row.id} order by position
  `;
  const bakingTemperature = bakingText(row.bakingTemperature);
  const bakingTime = bakingText(row.bakingTime);
  const lines = [
    `# ${row.title}`,
    row.description ? `\n${row.description}\n` : "",
    `\nPortionen: ${row.servings}\n`,
    bakingTemperature ? `Backtemperatur: ${bakingTemperature}\n` : "",
    bakingTime ? `Backzeit: ${bakingTime}\n` : "",
    `\n## Zutaten\n`,
    ...ingredients.map((item) => {
      const amount = item.amount ? Number(item.amount) : null;
      const unit = item.unitKey ?? "";
      return `- ${[amount ?? "", unit, item.name].filter(Boolean).join(" ")}${item.note ? ` (${item.note})` : ""}`;
    }),
    `\n## Schritte\n`,
    ...steps.map((step, index) => `${index + 1}. ${step.text}`),
    row.sourceUrl ? `\nQuelle: ${row.sourceUrl}\n` : "",
  ];
  c.header("content-type", "text/markdown; charset=utf-8");
  c.header("content-disposition", `attachment; filename="${encodeURIComponent(row.title)}.md"`);
  return c.body(lines.join("\n"));
});

recipes.post("/:id/export", async (c) => {
  const user = c.get("user");
  const { row } = await requireVisible(user.id, idParam(c));
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    insert into jobs (user_id, kind, payload, state)
    values (${user.id}, 'export_pdf', ${sql.json({ recipeId: row.id } as never)}, 'queued')
    returning id
  `;
  return ok(c, { jobId: rows[0]?.id, state: "queued" }, 202);
});
