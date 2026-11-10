import type { RecipeSummary } from "@kochen/contracts";
import { ChefHat, Lock, UtensilsCrossed } from "lucide-react";
import { Link } from "react-router-dom";
import { Avatar, Badge, Card, MediaImage, Skeleton, Stars } from "../ui";
import { ratingLabel } from "./format";

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const avg = recipe.avgRating ?? null;
  const count = recipe.ratingCount ?? 0;
  const tags = recipe.tags.slice(0, 3);
  const extraTags = recipe.tags.length - tags.length;
  const friends = recipe.variedByFriends ?? [];

  return (
    <Link to={`/rezept/${recipe.id}`} className="group block min-w-0 rounded-[var(--radius-card)]">
      <Card className="hover-lift flex h-full flex-col overflow-hidden">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-paper-2">
          <MediaImage
            src={recipe.coverUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
            fallback={
              <div className="paper-grain flex size-full items-center justify-center bg-[linear-gradient(135deg,var(--color-paper-2),var(--color-sage-soft))]">
                <ChefHat className="size-12 text-brand/35" strokeWidth={1.4} />
              </div>
            }
          />
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
            {recipe.archivedAt && <Badge tone="gold">Archiviert</Badge>}
            {recipe.cookedByMe && (
              <Badge tone="sage">
                <UtensilsCrossed className="size-3" />
                Gekocht
              </Badge>
            )}
            {recipe.visibility === "private" && (
              <Badge>
                <Lock className="size-3" />
                Privat
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <h3 className="text-lg leading-snug break-words text-ink">{recipe.title}</h3>
          <p className="mt-1 text-xs text-ink-soft">{recipe.owner.name}</p>

          {tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
              {extraTags > 0 && <Badge>+{extraTags}</Badge>}
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
            <span className="inline-flex items-center gap-1.5">
              <Stars value={avg} readOnly size={14} />
              <span className="text-xs text-ink-soft">
                {count > 0 ? `${count}` : "neu"}
              </span>
            </span>
            {recipe.categories.length > 0 && (
              <span className="truncate text-xs text-ink-soft">
                {recipe.categories.map((category) => category.name).join(" · ")}
              </span>
            )}
          </div>

          <span className="sr-only">{ratingLabel(avg, count)}</span>

          {friends.length > 0 && (
            <div className="mt-3 flex items-center gap-2 border-t border-line/70 pt-2.5">
              <div className="flex -space-x-2">
                {friends.slice(0, 4).map((friend) => (
                  <Avatar key={friend.id} name={friend.name} url={friend.avatarUrl} size={22} />
                ))}
              </div>
              <span className="text-xs text-ink-soft">
                {friends.length === 1
                  ? "1 Freund hat das Rezept variiert"
                  : `${friends.length} Freunde haben das Rezept variiert`}
              </span>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}

export function RecipeCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Card>
  );
}
