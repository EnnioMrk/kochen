import { RecipeInput, type RecipeInput as RecipeInputType } from "@kochen/contracts";
import { db } from "@kochen/db";
import { attachCategories, attachTags } from "./tags-lib";
import type { postgres } from "@kochen/db";

type Tx = postgres.TransactionSql<Record<string, unknown>>;

export async function writeLines(
  tx: Tx,
  recipeId: string,
  ingredients: Array<{ amount: number | null; unit: string | null; name: string; note?: string | null; lineageKey?: string }>,
  steps: Array<{ text: string; durationS?: number | null; lineageKey?: string }>,
): Promise<void> {
  await tx`delete from recipe_ingredients where recipe_id = ${recipeId}`;
  await tx`delete from recipe_steps where recipe_id = ${recipeId}`;
  for (const [index, item] of ingredients.entries()) {
    await tx`
      insert into recipe_ingredients (recipe_id, position, amount, unit_key, name, note, lineage_key)
      values (${recipeId}, ${index}, ${item.amount}, ${item.unit}, ${item.name}, ${item.note ?? null},
              ${item.lineageKey ?? crypto.randomUUID()})
    `;
  }
  for (const [index, item] of steps.entries()) {
    await tx`
      insert into recipe_steps (recipe_id, position, text, duration_s, lineage_key)
      values (${recipeId}, ${index}, ${item.text}, ${item.durationS ?? null}, ${item.lineageKey ?? crypto.randomUUID()})
    `;
  }
}

/** Create one recipe with its lines, tags, categories and images in one transaction. */
export async function createRecipe(
  userId: string,
  input: RecipeInputType,
  imageKeys: string[] = [],
): Promise<string> {
  const sql = db();
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into recipes (owner_id, title, description, servings, source_type, source_url, raw_text,
                           transcript, original_lang, visibility)
      values (${userId}, ${input.title}, ${input.description ?? null}, ${input.servings},
              ${input.sourceType}, ${input.sourceUrl ?? null}, ${input.rawText ?? null},
              ${input.transcript ?? null}, ${input.originalLang ?? null}, ${input.visibility})
      returning id
    `;
    const recipe = rows[0];
    if (!recipe) throw new Error("recipe_insert_failed");
    await writeLines(tx as Tx, recipe.id, input.ingredients, input.steps);
    await attachTags(tx as Tx, recipe.id, input.tagNames, userId);
    await attachCategories(tx as Tx, recipe.id, input.categoryIds, userId);
    for (const [index, key] of imageKeys.entries()) {
      await tx`
        insert into images (recipe_id, r2_key, kind, position)
        values (${recipe.id}, ${key}, ${index === 0 ? "cover" : "original"}, ${index})
      `;
    }
    return recipe.id;
  });
}

export { RecipeInput };
