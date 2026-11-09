import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FilterDsl, SearchResult } from "@kochen/contracts";
import { AlertTriangle, Search, Sparkles } from "lucide-react";
import { ApiError, api, qk } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  Textarea,
} from "../components/ui";
import { RecipeRow } from "../components/social/RecipeRow";
import { plural } from "../lib/utils";

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function personLabel(person: string): string {
  return person === "me" ? "ich" : person;
}

function ownerLabel(owner: FilterDsl["owner"]): string {
  if (owner === "me") return "nur meine Rezepte";
  if (owner === "friends") return "nur von Freunden";
  return "alle sichtbaren Rezepte";
}

function sortLabel(sort: FilterDsl["sort"]): string {
  if (sort === "newest") return "neueste zuerst";
  if (sort === "title") return "Titel A–Z";
  return "beste Bewertung zuerst";
}

function filterChips(filter: FilterDsl): string[] {
  const chips: string[] = [];
  for (const tag of filter.tagsAll) chips.push(`Tag: ${tag}`);
  for (const tag of filter.tagsAny) chips.push(`Tag (einer): ${tag}`);
  for (const category of filter.categories) chips.push(`Kategorie: ${category}`);
  for (const rating of filter.ratings) {
    chips.push(`Bewertung von ${personLabel(rating.person)}: ab ${number.format(rating.min)} Sternen`);
  }
  for (const person of filter.cookedBy) chips.push(`Schon gekocht: ${personLabel(person)}`);
  chips.push(ownerLabel(filter.owner));
  chips.push(sortLabel(filter.sort));
  return chips;
}

function searchErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "ai_unavailable") {
      return "Die Suche ist gerade nicht verfügbar. Die KI antwortet nicht. Deine Eingabe bleibt erhalten.";
    }
    if (error.code === "rate_limited") {
      return "Zu viele Suchanfragen. Bitte warte einen Moment.";
    }
    if (error.code === "validation_failed") {
      return "Die Suche konnte den Wunsch nicht lesen. Formuliere ihn bitte anders.";
    }
    if (error.code === "unauthenticated" || error.code === "not_member" || error.code === "forbidden") {
      return "Du hast keinen Zugriff auf die Suche.";
    }
  }
  return "Die Suche ist fehlgeschlagen. Bitte versuche es erneut.";
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const [text, setText] = useState(query);

  useEffect(() => {
    setText(query);
  }, [query]);

  const search = useQuery({
    queryKey: qk.search(query),
    queryFn: () => api<SearchResult>("/api/search", { method: "POST", body: { query } }),
    enabled: query.length > 0,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = text.trim();
    if (!next) return;
    if (next === query) {
      if (search.isError) void search.refetch();
      return;
    }
    setParams({ q: next });
  };

  const chips = useMemo(() => (search.data ? filterChips(search.data.filter) : []), [search.data]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Suche"
        eyebrow="Beschreiben statt filtern"
        subtitle="Sage in deinen Worten, was du kochen möchtest. Die Suche liest daraus einen Filter."
      />

      <Card className="p-4 sm:p-5">
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="search-query" className="block text-sm font-medium text-ink">
            Beschreibe, was du suchst
          </label>
          <Textarea
            id="search-query"
            value={text}
            rows={3}
            maxLength={500}
            placeholder="Zum Beispiel: schnelle vegetarische Gerichte unter 30 Minuten, die ich noch nie gekocht habe."
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-soft">{text.length} von 500 Zeichen</span>
            <Button type="submit" loading={search.isFetching} disabled={!text.trim()}>
              <Search className="size-4" />
              Suchen
            </Button>
          </div>
        </form>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-soft">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-sage" />
          Die Suche versteht Tags, Kategorien, Personen, Bewertungen und Sortierung. Es gibt kein zweites Suchfeld.
        </p>
      </Card>

      {!query && (
        <div className="mt-5">
          <EmptyState
            title="Noch keine Suche"
            body="Schreibe einen Wunsch in das Feld. Zum Beispiel: „Rezepte von Anna, die ich mit vier Sternen bewertet habe“."
          />
        </div>
      )}

      {query && search.isPending && (
        <Card className="mt-5 space-y-4 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton className="size-14 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </Card>
      )}

      {query && search.isError && (
        <Card className="mt-5 border-danger/30 bg-danger/5 p-4">
          <p className="flex items-start gap-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {searchErrorText(search.error)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void search.refetch()}>
              Erneut versuchen
            </Button>
            <span className="self-center text-xs text-ink-soft">Dein Text bleibt im Feld.</span>
          </div>
        </Card>
      )}

      {query && search.data && (
        <div className="mt-5 space-y-3">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
              So wurde dein Wunsch gelesen
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {chips.map((chip, index) => (
                <li key={`${chip}-${index}`}>
                  <Badge tone={index < 4 ? "brand" : "neutral"}>{chip}</Badge>
                </li>
              ))}
            </ul>
          </div>

          <Card className="p-2 sm:p-3">
            {search.data.recipes.length === 0 ? (
              <div className="p-2">
                <EmptyState
                  title="Kein Rezept gefunden"
                  body="Der Filter war gültig, aber kein Rezept passt. Formuliere den Wunsch anders."
                />
              </div>
            ) : (
              <>
                <p className="px-2 pb-1 pt-2 text-sm text-ink-soft">
                  {search.data.recipes.length} {plural(search.data.recipes.length, "Rezept", "Rezepte")} gefunden
                </p>
                <div className="divide-y divide-line/60">
                  {search.data.recipes.map((recipe) => (
                    <RecipeRow key={recipe.id} recipe={recipe} />
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
