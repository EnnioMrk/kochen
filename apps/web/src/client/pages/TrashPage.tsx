import type { RecipeSummary } from "@kochen/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api, qk } from "../lib/api";
import { errorText, plural } from "../lib/utils";
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, useToast } from "../components/ui";

type TrashResponse = { items: RecipeSummary[]; retentionDays: number };

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(deletedAt: string, retentionDays: number): number {
  const purgeAt = new Date(deletedAt).getTime() + retentionDays * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / DAY_MS));
}

export function TrashPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: qk.trash,
    queryFn: () => api<TrashResponse>("/api/recipes/trash"),
  });

  const restore = useMutation({
    mutationFn: (id: string) => api(`/api/recipes/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      toast.push("Rezept wiederhergestellt.", "success");
      void queryClient.invalidateQueries({ queryKey: qk.trash });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const items = list.data?.items ?? [];
  const retentionDays = list.data?.retentionDays ?? 7;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Papierkorb"
        subtitle={`Gelöschte Rezepte bleiben ${retentionDays} Tage hier. Danach werden sie endgültig gelöscht.`}
      />

      {list.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      )}

      {list.isError && (
        <EmptyState
          title="Papierkorb konnte nicht geladen werden"
          body={errorText(list.error)}
          icon={<Trash2 className="size-8" />}
          action={
            <Button variant="secondary" onClick={() => void list.refetch()}>
              Erneut versuchen
            </Button>
          }
        />
      )}

      {!list.isLoading && !list.isError && items.length === 0 && (
        <EmptyState
          title="Papierkorb ist leer"
          body="Wenn du ein Rezept löschst, kannst du es hier innerhalb von sieben Tagen wiederherstellen."
          icon={<Trash2 className="size-8" />}
          action={
            <Link to="/">
              <Button variant="secondary">Zu meinen Rezepten</Button>
            </Link>
          }
        />
      )}

      {items.length > 0 && (
        <>
          <p className="text-xs text-ink-soft">
            {items.length} {plural(items.length, "Rezept", "Rezepte")}
          </p>
          <div className="space-y-3">
            {items.map((recipe) => {
              const left = recipe.deletedAt ? daysLeft(recipe.deletedAt, retentionDays) : 0;
              return (
                <Card key={recipe.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/rezept/${recipe.id}`}
                      className="block truncate text-lg text-ink underline-offset-4 hover:underline"
                    >
                      {recipe.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                      {recipe.deletedAt && (
                        <span>
                          Gelöscht am{" "}
                          {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(
                            new Date(recipe.deletedAt),
                          )}
                        </span>
                      )}
                      <Badge tone={left <= 1 ? "danger" : left <= 3 ? "gold" : "neutral"}>
                        {left <= 1 ? "Letzter Tag" : `Noch ${left} Tage`}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={restore.isPending && restore.variables === recipe.id}
                    onClick={() => restore.mutate(recipe.id)}
                  >
                    <RotateCcw className="size-4" />
                    Wiederherstellen
                  </Button>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
