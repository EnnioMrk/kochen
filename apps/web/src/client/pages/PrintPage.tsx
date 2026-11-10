import type { RecipeDetail } from "@kochen/contracts";
import { formatAmount, presentAmount, unitLabel } from "@kochen/core";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api, qk } from "../lib/api";
import { errorText, formatDate } from "../lib/utils";
import { Button, EmptyState, Skeleton } from "../components/ui";
import {
  SOURCE_LABEL,
  durationLabel,
  servingsLabel,
} from "../components/recipes/format";

export function PrintPage() {
  const { id = "" } = useParams<{ id: string }>();
  const host = window.location.host;
  const detail = useQuery({
    queryKey: qk.recipe(id),
    queryFn: () => api<RecipeDetail>(`/api/recipes/${id}`),
    enabled: Boolean(id),
  });
  const recipe = detail.data;
  const categoryNames = new Set(
    (recipe?.categories ?? []).map((category) => category.name.toLocaleLowerCase("de")),
  );
  const tagLine = recipe
    ? [
        ...recipe.categories.map((category) => category.name),
        ...recipe.tags.filter((tag) => !categoryNames.has(tag.toLocaleLowerCase("de"))),
      ].join(" · ")
    : "";
  const bakingLine = recipe
    ? [
        recipe.bakingTemperature?.trim() ? `Backtemperatur: ${recipe.bakingTemperature.trim()}` : "",
        recipe.bakingTime?.trim() ? `Backzeit: ${recipe.bakingTime.trim()}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="min-h-dvh bg-white text-black">
      <div className="no-print mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-8">
        <Link
          to={`/rezept/${id}`}
          className="tap inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
        >
          <ArrowLeft className="size-4" />
          Zurück zum Rezept
        </Link>
        <Button onClick={() => window.print()} disabled={!recipe}>
          <Printer className="size-4" />
          Drucken
        </Button>
      </div>

      {detail.isLoading && (
        <div className="mx-auto max-w-[210mm] space-y-3 px-6 py-6">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {detail.isError && (
        <div className="mx-auto max-w-xl px-6 py-10">
          <EmptyState
            title="Rezept konnte nicht geladen werden"
            body={errorText(detail.error)}
            action={
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                Erneut versuchen
              </Button>
            }
          />
        </div>
      )}

      {recipe && (
        <article className="print-page mx-auto w-full max-w-[210mm] px-5 py-6 sm:px-9 sm:py-8">
          <header className="border-b border-black/20 pb-4">
            <h1 className="text-2xl font-semibold leading-tight break-words text-black sm:text-3xl">
              {recipe.title}
            </h1>
            {recipe.description && (
              <p className="mt-2 max-w-[80ch] whitespace-pre-wrap text-sm leading-relaxed text-black/80">
                {recipe.description}
              </p>
            )}
            <p className="mt-3 text-sm text-black">
              {servingsLabel(recipe.servings)} · von{" "}
              {recipe.owner.deletedAt ? "gelöschtem Konto" : recipe.owner.name}
            </p>
            <p className="mt-0.5 text-xs text-black/60">
              Quelle: {SOURCE_LABEL[recipe.sourceType]}
              {recipe.updatedAt ? ` · Stand ${formatDate(recipe.updatedAt)}` : ""}
            </p>
            {(recipe.tags.length > 0 || recipe.categories.length > 0) && (
              <p className="mt-1 text-xs text-black/70">{tagLine}</p>
            )}
          </header>

          <section className="mt-5">
            <h2 className="text-lg font-semibold">Zutaten</h2>
            {bakingLine && (
              <p className="mt-1 text-xs text-black/80">{bakingLine}</p>
            )}
            {recipe.ingredients.length === 0 ? (
              <p className="mt-1 text-sm text-black/70">Keine Zutaten eingetragen.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {recipe.ingredients.map((item, index) => {
                  const shown =
                    item.amount === null ? null : presentAmount(item.amount, item.unit);
                  const amount = shown
                    ? [
                        formatAmount(shown.amount),
                        item.unitLabel ?? unitLabel(shown.unit, shown.amount),
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : "";
                  return (
                    <li
                      key={item.id ?? item.lineageKey ?? `print-ingredient-${index}`}
                      className="flex items-start gap-3 text-sm"
                    >
                      <span className="w-20 shrink-0 text-right font-medium tabular-nums sm:w-24">
                        {amount}
                      </span>
                      <span className="min-w-0 flex-1 break-words">
                        {item.name}
                        {item.note ? (
                          <span className="text-black/60"> ({item.note})</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="mt-5">
            <h2 className="text-lg font-semibold">Schritte</h2>
            {recipe.steps.length === 0 ? (
              <p className="mt-1 text-sm text-black/70">Keine Schritte eingetragen.</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {recipe.steps.map((step, index) => (
                  <li
                    key={step.id ?? step.lineageKey ?? `print-step-${index}`}
                    className="print-avoid-break flex gap-3"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-black/30 text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {step.text}
                      </p>
                      {step.durationS ? (
                        <p className="mt-0.5 text-xs text-black/60">
                          Dauer: {durationLabel(step.durationS)}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <footer className="mt-8 border-t border-black/20 pt-3 text-xs text-black/70">
            <p>
              Von {recipe.owner.deletedAt ? "gelöschtem Konto" : recipe.owner.name} ·
              erstellt {formatDate(recipe.createdAt)}
            </p>
            {recipe.sourceUrl && (
              <p className="mt-1 break-all">Quelle: {recipe.sourceUrl}</p>
            )}
            <p className="mt-1">
              Kochen · {host}
            </p>
          </footer>
        </article>
      )}
    </div>
  );
}
