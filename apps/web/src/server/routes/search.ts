import { Hono } from "hono";
import { FilterDsl, SearchInput } from "@kochen/contracts";
import { compileFilter, FilterValidationError, personTokens } from "@kochen/core";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { aiCall, rateLimit } from "../ai";
import { invalid, ok } from "../errors";
import { RECIPE_SELECT, friendIdsOf, mapFlat, toSummaries, type FlatRecipe } from "../repo";
import type { AppEnv } from "../types";
import { body } from "../validate";

export const search = new Hono<AppEnv>();
search.use("*", requireUser);

search.post("/", async (c) => {
  const user = c.get("user");
  const input = await body(c, SearchInput);
  rateLimit(`search:${user.id}`, 30);

  const sql = db();
  const friends = await friendIdsOf(user.id);
  const friendRows = friends.length > 0
    ? await sql<{ id: string; name: string }[]>`
        select id, name from users where id = any(${friends}::uuid[]) and deleted_at is null
      `
    : [];
  const tagRows = await sql<{ slug: string }[]>`select slug from tags`;
  const categoryRows = await sql<{ name: string }[]>`
    select distinct c.name from categories c
    where c.owner_id = ${user.id}
       or c.owner_id = any(${friends}::uuid[])
    order by c.name
  `;

  const persons = {
    ...personTokens({ id: user.id, name: user.name }, friendRows),
  };

  const parsed = await aiCall((provider) =>
    provider.parseFilter({
      query: input.query,
      persons: ["me", ...friendRows.map((friend) => friend.name)],
      tags: tagRows.map((tag) => tag.slug),
      categories: categoryRows.map((category) => category.name),
    }),
  );

  // The model may answer with keys outside the schema; validate again here.
  const filter = FilterDsl.parse(parsed);
  let compiled;
  try {
    compiled = compileFilter(filter, {
      viewerId: user.id,
      friendIds: friends,
      persons,
      knownTags: tagRows.map((tag) => tag.slug),
      knownCategories: categoryRows.map((category) => category.name),
    });
  } catch (error) {
    if (error instanceof FilterValidationError) throw invalid(error.message);
    throw error;
  }

  const text = `${RECIPE_SELECT} where ${compiled.whereSql} order by ${compiled.orderBy} limit 60`;
  const rows = await sql.unsafe<FlatRecipe[]>(text, compiled.params);
  const recipes = await toSummaries(rows.map(mapFlat), user.id);
  return ok(c, { filter, recipes });
});
