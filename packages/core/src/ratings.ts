/** Rating rules: half stars, one row per person and recipe, cook gate. */

export const HALF_STEPS = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5,
] as const;

export function isValidStars(stars: number): boolean {
  return HALF_STEPS.includes(stars as (typeof HALF_STEPS)[number]);
}

/**
 * Only a person who cooked can rate.
 * `cookCount` counts cook events of that person for that recipe.
 */
export function canRate(cookCount: number): boolean {
  return Number.isFinite(cookCount) && cookCount > 0;
}

export function assertRating(cookCount: number, stars: number): void {
  if (!canRate(cookCount)) throw new Error("rating_requires_cook");
  if (!isValidStars(stars)) throw new Error("invalid_stars");
}

export type ChainNode = {
  id: string;
  parentId: string | null;
  depth: number;
};

/**
 * Rating chain rule: a person's own rating of the recipe counts first.
 * Then the next rating of that person up the chain counts.
 * A rating outside the chain never counts.
 *
 * `ratings` maps recipe id to stars for one person only.
 * `chain` starts at the recipe and walks parents, ordered by depth.
 */
export function chainRating(
  chain: ChainNode[],
  ratings: Record<string, number | null | undefined>,
): { stars: number; recipeId: string; depth: number } | null {
  const ordered = [...chain].sort((a, b) => a.depth - b.depth);
  for (const node of ordered) {
    const stars = ratings[node.id];
    if (typeof stars === "number" && isValidStars(stars)) {
      return { stars, recipeId: node.id, depth: node.depth };
    }
  }
  return null;
}

export function buildChain(
  start: { id: string; parentId: string | null },
  parents: Record<string, { id: string; parentId: string | null }>,
): ChainNode[] {
  const out: ChainNode[] = [];
  const seen = new Set<string>();
  let current: { id: string; parentId: string | null } | null = start;
  let depth = 0;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push({ id: current.id, parentId: current.parentId, depth });
    current = current.parentId ? parents[current.parentId] ?? null : null;
    depth += 1;
  }
  return out;
}

export function averageRating(values: number[]): number | null {
  const valid = values.filter(isValidStars);
  if (valid.length === 0) return null;
  const sum = valid.reduce((a, b) => a + b, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}
