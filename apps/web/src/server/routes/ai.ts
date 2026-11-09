import { Hono } from "hono";
import { z } from "zod";
import { AiQuestion } from "@kochen/contracts";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { aiCall, rateLimit } from "../ai";
import { notFound, ok } from "../errors";
import { requireVisible } from "../repo";
import type { AppEnv } from "../types";
import { body, idParam, linkToken } from "../validate";

export const ai = new Hono<AppEnv>();
ai.use("*", requireUser);

ai.post("/answer", async (c) => {
  const user = c.get("user");
  const input = await body(c, AiQuestion);
  rateLimit(`ai-answer:${user.id}`, 20);
  let recipe: { title: string; servings: number; description: string | null; ingredients: import("@kochen/contracts").Ingredient[]; steps: import("@kochen/contracts").RecipeStep[] } | undefined;
  if (input.recipeId) {
    const visible = await requireVisible(user.id, input.recipeId, linkToken(c));
    const { ingredients, steps, ...rest } = await (await import("../repo")).detailFor(visible.row, visible.access, user.id);
    recipe = { ...rest, ingredients, steps };
  }
  const result = await aiCall((provider) =>
    provider.answer({ question: input.question, recipe }),
  );
  return ok(c, {
    answer: result.answer,
    provider: "ai",
    kind: result.kind,
  });
});

const SuggestInput = z.object({ recipeId: z.string().uuid() });

ai.post("/suggest-tags", async (c) => {
  const user = c.get("user");
  const input = await body(c, SuggestInput);
  rateLimit(`ai-tags:${user.id}`, 30);
  const { row, access } = await requireVisible(user.id, input.recipeId, linkToken(c));
  if (!access.edit) throw notFound();
  const sql = db();
  const [detail, tagRows, categoryRows] = await Promise.all([
    (await import("../repo")).detailFor(row, access, user.id),
    sql<{ label: string }[]>`select label from tags order by created_at desc limit 200`,
    sql<{ name: string }[]>`
      select c.name from categories c
      where c.owner_id = ${user.id}
         or exists (
           select 1 from friendships f where f.status = 'accepted'
             and f.user_low = least(${user.id}::uuid, c.owner_id)
             and f.user_high = greatest(${user.id}::uuid, c.owner_id)
         )
      order by c.name limit 100
    `,
  ]);
  const existingTags = tagRows.map((tag) => tag.label);
  const result = await aiCall((provider) =>
    provider.suggestTags({
      recipe: {
        title: detail.title,
        description: detail.description,
        ingredients: detail.ingredients,
        steps: detail.steps,
      },
      existingTags,
      categories: categoryRows.map((category) => category.name),
    }),
  );
  return ok(c, {
    existing: result.existing.map((label) => ({
      slug: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      usage: 0,
    })),
    newTags: result.newTags,
    category: result.category,
  });
});
