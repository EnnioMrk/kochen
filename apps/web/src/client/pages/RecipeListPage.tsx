import { useState } from "react";
import type { RecipeSummary, Tag } from "@kochen/contracts";
import { useQuery } from "@tanstack/react-query";
import { Archive, BookOpen, Camera, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, qk } from "../lib/api";
import { cn, errorText, plural } from "../lib/utils";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { RecipeCard, RecipeCardSkeleton } from "../components/recipes/RecipeCard";

const linkButton =
  "tap inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium text-ink shadow-sm transition hover:border-ink/30";

export function RecipeListPage({ scope }: { scope: "mine" | "all" }) {
  const navigate = useNavigate();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);

  const tags = useQuery({
    queryKey: qk.tags(""),
    queryFn: () => api<Tag[]>("/api/tags"),
    staleTime: 120_000,
  });

  const query = new URLSearchParams({
    scope,
    archived: archived ? "true" : "false",
    limit: "60",
  });
  if (selectedTags.length > 0) query.set("tags", selectedTags.join(","));

  const list = useQuery({
    queryKey: [...qk.recipes(scope), selectedTags.join(","), archived] as const,
    queryFn: () => api<{ items: RecipeSummary[] }>(`/api/recipes?${query.toString()}`),
  });

  const items = list.data?.items ?? [];
  const visibleTags = (tags.data ?? []).slice(0, 14);
  const filtered = selectedTags.length > 0 || archived;

  const toggleTag = (slug: string) => {
    setSelectedTags((current) =>
      current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug],
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={scope === "mine" ? "Meine Rezepte" : "Entdecken"}
        subtitle={
          scope === "mine"
            ? "Deine eigenen Rezepte und deine Varianten."
            : "Rezepte, die Freunde und andere Mitglieder geteilt haben."
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate("/erfassen")}>
              <Camera className="size-4" />
              Erfassen
            </Button>
            <Button onClick={() => navigate("/neu")}>
              <Plus className="size-4" />
              <span className="sm:hidden">Neu</span>
              <span className="hidden sm:inline">Neues Rezept</span>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar scroll-fade -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          <span className="mr-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-ink-soft">
            <SlidersHorizontal className="size-3.5" />
            Tags
          </span>
          {visibleTags.length === 0 && (
            <span className="shrink-0 text-xs text-ink-soft">Noch keine Tags.</span>
          )}
          {visibleTags.map((tag) => {
            const active = selectedTags.includes(tag.slug);
            return (
              <button
                key={tag.slug}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag.slug)}
                className={cn(
                  "tap tap-target min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition",
                  active
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white text-ink-soft hover:border-ink/30 hover:text-ink",
                )}
              >
                {tag.label}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => setSelectedTags([])}
            >
              Filter zurücksetzen
            </Button>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant={archived ? "sage" : "secondary"}
            size="sm"
            aria-pressed={archived}
            onClick={() => setArchived((current) => !current)}
          >
            <Archive className="size-4" />
            Archiv
          </Button>
          <Link to="/suche" className={cn(linkButton, "max-sm:hidden")}>
            <Search className="size-4" />
            Suche
          </Link>
        </div>
      </div>

      {archived && (
        <p className="rounded-xl border border-gold/40 bg-gold/[0.08] px-3 py-2 text-sm text-ink">
          Du siehst das Archiv. Diese Rezepte sind ausgeblendet, aber nicht
          gelöscht.
        </p>
      )}

      {list.isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <RecipeCardSkeleton key={index} />
          ))}
        </div>
      )}

      {list.isError && (
        <EmptyState
          title="Rezepte konnten nicht geladen werden"
          body={errorText(list.error)}
          icon={<BookOpen className="size-8" />}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Erneut versuchen
            </Button>
          }
        />
      )}

      {!list.isLoading && !list.isError && items.length === 0 && (
        <EmptyState
          title={filtered ? "Keine Treffer" : scope === "mine" ? "Noch keine Rezepte" : "Nichts zu entdecken"}
          body={
            filtered
              ? "Ändere den Filter oder sieh im Archiv nach."
              : scope === "mine"
                ? "Lege dein erstes Rezept an. Du kannst es auch aus einem Foto, Link oder Video erfassen."
                : "Sobald Freunde oder Mitglieder Rezepte teilen, erscheinen sie hier."
          }
          icon={<BookOpen className="size-8" />}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedTags([]);
                  setArchived(false);
                }}
              >
                Filter zurücksetzen
              </Button>
            ) : (
              <Button onClick={() => navigate("/neu")}>
                <Plus className="size-4" />
                Erstes Rezept anlegen
              </Button>
            )
          }
        />
      )}

      {items.length > 0 && (
        <>
          <p className="text-xs text-ink-soft">
            {items.length} {plural(items.length, "Rezept", "Rezepte")}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
