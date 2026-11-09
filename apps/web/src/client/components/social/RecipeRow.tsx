import { Link } from "react-router-dom";
import type { RecipeSummary } from "@kochen/contracts";
import { ChefHat } from "lucide-react";
import { Badge, Stars } from "../ui";
import { cn } from "../../lib/utils";

export function recipeMeta(recipe: RecipeSummary): string {
  const parts: string[] = [];
  parts.push(`${recipe.servings} ${recipe.servings === 1 ? "Portion" : "Portionen"}`);
  if (recipe.avgRating) parts.push(`Ø ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(recipe.avgRating)} Sterne`);
  return parts.join(" · ");
}

export function RecipeRow({
  recipe,
  showOwner = true,
  className,
}: {
  recipe: RecipeSummary;
  showOwner?: boolean;
  className?: string;
}) {
  return (
    <Link
      to={`/rezept/${recipe.id}`}
      className={cn(
        "tap group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-ink/5",
        className,
      )}
    >
      <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-paper-2 text-ink-soft">
        {recipe.coverUrl ? (
          <img src={recipe.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <ChefHat className="size-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink group-hover:underline">{recipe.title}</span>
          {recipe.parentId && (
            <Badge tone="sage" className="shrink-0 px-2 py-0.5">
              Variante
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          {showOwner && <span>{recipe.owner.name}</span>}
          {recipe.avgRating ? (
            <span className="inline-flex items-center gap-1">
              <Stars value={recipe.avgRating} readOnly size={12} />
              <span>({recipe.ratingCount ?? 0})</span>
            </span>
          ) : (
            <span>Noch keine Bewertung</span>
          )}
          {recipe.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded-full bg-ink/5 px-2 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export function RecipeCard({ recipe, className }: { recipe: RecipeSummary; className?: string }) {
  return (
    <Link
      to={`/rezept/${recipe.id}`}
      className={cn(
        "tap group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white/80 transition hover:border-ink/20",
        className,
      )}
    >
      <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-paper-2 text-ink-soft">
        {recipe.coverUrl ? (
          <img
            src={recipe.coverUrl}
            alt=""
            className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <ChefHat className="size-7" />
        )}
        {recipe.parentId && (
          <span className="absolute left-2 top-2">
            <Badge tone="sage">Variante</Badge>
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col gap-1 p-3">
        <span className="line-clamp-2 font-medium text-ink group-hover:underline">{recipe.title}</span>
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          <span>{recipe.owner.name}</span>
          {recipe.avgRating ? (
            <span className="inline-flex items-center gap-1">
              <Stars value={recipe.avgRating} readOnly size={12} />
              <span>({recipe.ratingCount ?? 0})</span>
            </span>
          ) : (
            <span>unbewertet</span>
          )}
        </span>
      </span>
    </Link>
  );
}
