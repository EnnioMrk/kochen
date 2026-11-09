import { Hono } from "hono";
import { ShoppingInput } from "@kochen/contracts";
import { buildShoppingList } from "@kochen/core";
import { db } from "@kochen/db";
import { requireUser } from "../auth";
import { notFound, ok } from "../errors";
import { accessForRecipe, requireRecipeRow } from "../repo";
import type { AppEnv } from "../types";
import { body } from "../validate";

export const shopping = new Hono<AppEnv>();
shopping.use("*", requireUser);

/**
 * Shopping list from several recipes and chosen servings.
 * The member's own latest variation in the chain supplies the amounts.
 */
shopping.post("/", async (c) => {
  const user = c.get("user");
  const input = await body(c, ShoppingInput);
  const sql = db();
  const ids = input.items.map((item) => item.recipeId);



  const warnings: string[] = [];
  const sources = [];

  for (const item of input.items) {
    const row = await requireRecipeRow(item.recipeId);
    const access = await accessForRecipe(user.id, row);
    if (!access.view) throw notFound();

    const own = await sql<{ id: string; servings: number; title: string }[]>`
      select id, servings, title from recipes
      where root_id = ${row.rootId} and owner_id = ${user.id} and deleted_at is null and archived_at is null
      order by created_at desc limit 1
    `;
    const chosen = own[0] ?? { id: row.id, servings: row.servings, title: row.title };

    const ingredients = await sql<{ amount: string | null; unitKey: string | null; name: string }[]>`
      select amount, unit_key as "unitKey", name from recipe_ingredients
      where recipe_id = ${chosen.id} order by position
    `;
    if (ingredients.length === 0) warnings.push(`keine_zutaten:${chosen.title}`);
    sources.push({
      recipeId: row.id,
      recipeTitle: chosen.title,
      servings: item.servings,
      baseServings: Number(chosen.servings),
      ingredients: ingredients.map((ingredient) => ({
        amount: ingredient.amount === null ? null : Number(ingredient.amount),
        unit: ingredient.unitKey,
        name: ingredient.name,
      })),
    });
  }

  const list = buildShoppingList(sources);
  return ok(c, { items: list.items, warnings: [...warnings, ...list.warnings] });
});

