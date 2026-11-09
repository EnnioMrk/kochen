import type { ShoppingItem } from "@kochen/contracts";
import type { z } from "zod";
import { ShoppingItem as ShoppingItemSchema } from "@kochen/contracts";
import { mergeAmount, presentAmount, scaleAmount, unitOf } from "./units";

export type ShoppingSource = {
  recipeId: string;
  recipeTitle: string;
  servings: number;
  baseServings: number;
  ingredients: Array<{
    amount: number | null;
    unit: string | null;
    name: string;
    note?: string | null;
  }>;
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

/**
 * Build one shopping list from several recipes and servings.
 * The member's own amounts are used (their variation is resolved before this call).
 * Equal units merge. Teaspoon and tablespoon stay separate.
 */
export function buildShoppingList(sources: ShoppingSource[]): {
  items: Array<z.infer<typeof ShoppingItemSchema>>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const map = new Map<string, z.infer<typeof ShoppingItemSchema> & { sortName: string }>();

  for (const source of sources) {
    const factor = source.baseServings > 0 ? source.servings / source.baseServings : 1;
    if (source.servings <= 0) {
      warnings.push(`ungueltige_portionen:${source.recipeTitle}`);
      continue;
    }
    for (const ingredient of source.ingredients) {
      const name = ingredient.name.trim();
      if (!name) continue;
      const unit = ingredient.unit;
      const amount =
        ingredient.amount === null ? null : scaleAmount(ingredient.amount, unit, factor);
      const key = `${normalizeName(name)}|${unit ?? "none"}`;
      const existing = map.get(key);
      if (existing && amount !== null && existing.amount !== null && unit) {
        const merged = mergeAmount(
          { amount: existing.amount, unit: existing.unit },
          { amount, unit },
        );
        existing.amount = merged.amount;
        existing.sources.push(source.recipeTitle);
        continue;
      }
      if (existing) {
        // Two lines of the same name with no mergeable amount stay apart.
        existing.sources.push(source.recipeTitle);
        continue;
      }
      const def = unitOf(unit);
      map.set(key, {
        key,
        name,
        amount,
        unit: unit as z.infer<typeof ShoppingItemSchema>["unit"],
        unitLabel: def ? def.plural : null,
        sources: [source.recipeTitle],
        sortName: normalizeName(name),
      });
    }
  }

  const items = [...map.values()]
    .sort((a, b) => a.sortName.localeCompare(b.sortName, "de"))
    .map((item) => {
      const shown = presentAmount(item.amount ?? 0, item.unit);
      return {
        key: item.key,
        name: item.name,
        amount: item.amount === null ? null : shown.amount,
        unit: shown.unit as z.infer<typeof ShoppingItemSchema>["unit"],
        unitLabel: unitOf(shown.unit)?.plural ?? item.unitLabel,
        sources: [...new Set(item.sources)],
      };
    });

  return { items, warnings };
}
