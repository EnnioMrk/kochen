import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { RecipeSummary, ShoppingList } from "@kochen/contracts";
import { AlertTriangle, Check, Info, Plus, Search, ShoppingBasket, Trash2, X } from "lucide-react";
import { ApiError, api, qk } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  useToast,
} from "../components/ui";
import { Stepper } from "../components/social/Stepper";
import { cn } from "../lib/utils";

const STORAGE_KEY = "kochen.shopping";

type Selection = { recipeId: string; title: string; owner: string; servings: number };
type ShoppingItem = ShoppingList["items"][number];

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

function readChecked(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function storeChecked(items: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // A full or blocked storage only loses the check marks.
  }
}

function amountText(item: ShoppingItem): string {
  if (item.amount === null) return "nach Bedarf";
  const label = item.unitLabel ?? item.unit ?? "";
  return `${number.format(item.amount)}${label ? ` ${label}` : ""}`;
}

function warningText(warning: string): string {
  const [code, ...rest] = warning.split(":");
  const title = rest.join(":");
  if (code === "keine_zutaten") return `Für „${title}“ sind keine Zutaten hinterlegt.`;
  if (code === "ungueltige_portionen") return `Für „${title}“ sind die Portionen ungültig.`;
  return warning;
}

function shoppingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "not_found") return "Ein Rezept ist nicht mehr sichtbar. Entferne es aus der Auswahl.";
    if (error.code === "validation_failed") return "Bitte prüfe die Portionen. Erlaubt sind 1 bis 100.";
    if (error.code === "rate_limited") return "Zu viele Anfragen. Bitte warte einen Moment.";
    if (error.code === "unauthenticated" || error.code === "not_member") return "Bitte melde dich an.";
    return error.message || "Die Einkaufsliste konnte nicht erstellt werden.";
  }
  return "Die Einkaufsliste konnte nicht erstellt werden.";
}

export function ShoppingPage() {
  const toast = useToast();
  const [selection, setSelection] = useState<Selection[]>([]);
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ShoppingList | null>(null);
  const [checked, setChecked] = useState<string[]>(() => readChecked());
  const [confirmClear, setConfirmClear] = useState(false);
  const pickerRef = useRef<HTMLUListElement>(null);
  const [pickerScrollable, setPickerScrollable] = useState(false);

  const recipesQuery = useQuery({
    queryKey: qk.recipes("all"),
    queryFn: () => api<{ items: RecipeSummary[] }>("/api/recipes?scope=all&limit=100"),
  });

  const build = useMutation({
    mutationFn: () =>
      api<ShoppingList>("/api/shopping", {
        method: "POST",
        body: { items: selection.map((item) => ({ recipeId: item.recipeId, servings: item.servings })) },
      }),
    onSuccess: (data) => {
      setList(data);
      setChecked([]);
      storeChecked([]);
      toast.push("Einkaufsliste erstellt.", "success");
    },
    onError: (error) => {
      toast.push(shoppingError(error), "error");
    },
  });

  useEffect(() => {
    storeChecked(checked);
  }, [checked]);

  const chosenIds = useMemo(() => new Set(selection.map((item) => item.recipeId)), [selection]);

  /* The recipe picker scrolls on small screens. Only fade its bottom edge when
     it really overflows, so a short list keeps clean rows. */
  useEffect(() => {
    const element = pickerRef.current;
    if (!element) return;
    const measure = () => setPickerScrollable(element.scrollHeight > element.clientHeight + 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [recipesQuery.data, search]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = recipesQuery.data?.items ?? [];
    if (!term) return items;
    return items.filter((recipe) => {
      const haystack = [recipe.title, recipe.owner.name, ...recipe.tags].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [recipesQuery.data, search]);

  const add = (recipe: RecipeSummary) => {    if (chosenIds.has(recipe.id)) return;
    setSelection((current) => [
      ...current,
      { recipeId: recipe.id, title: recipe.title, owner: recipe.owner.name, servings: recipe.servings },
    ]);
  };

  const remove = (recipeId: string) => {
    setSelection((current) => current.filter((item) => item.recipeId !== recipeId));
  };

  const setServings = (recipeId: string, servings: number) => {
    setSelection((current) =>
      current.map((item) => (item.recipeId === recipeId ? { ...item, servings } : item)),
    );
  };

  const items = list?.items ?? [];
  const checkedCount = items.filter((item) => checked.includes(item.key)).length;
  const progress = items.length > 0 ? Math.round((checkedCount / items.length) * 100) : 0;

  const toggle = (key: string) => {
    setChecked((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const clearAll = () => {
    setList(null);
    setChecked([]);
    storeChecked([]);
    setSelection([]);
    setConfirmClear(false);
    toast.push("Liste geleert.", "info");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Einkaufsliste"
        subtitle="Wähle Rezepte und Portionen. Die Zutaten werden zu einer Liste zusammengefasst."
      />

      {list && (
        <div className="sticky top-[calc(4rem+var(--safe-top)+0.25rem)] z-10 mb-5">
          <Card className="border-sage/30 bg-white/95 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {checkedCount} von {items.length} erledigt
                </p>
                <p className="text-xs text-ink-soft">
                  {items.length === 1 ? "1 Artikel" : `${items.length} Artikel`} auf der Liste
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmClear(true)}>
                <Trash2 className="size-4" />
                Liste leeren
              </Button>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${progress}%` }} />
            </div>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        <Card className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <ShoppingBasket className="size-5 text-brand" />
            Rezepte auswählen
          </h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
            <Input
              className="pl-10"
              value={search}
              placeholder="Nach Titel, Person oder Tag suchen"
              aria-label="Rezepte durchsuchen"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {recipesQuery.isPending && (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}

          {recipesQuery.isError && (
            <p className="mt-3 flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Die Rezepte konnten nicht geladen werden.
            </p>
          )}

          {recipesQuery.data && filtered.length === 0 && (
            <p className="mt-3 text-sm text-ink-soft">
              {search.trim() ? "Kein Rezept passt zur Suche." : "Es gibt noch keine sichtbaren Rezepte."}
            </p>
          )}

          {filtered.length > 0 && (
            <ul
              ref={pickerRef}
              className={cn(
                "mt-3 max-h-80 divide-y divide-line/60 overflow-y-auto rounded-xl border border-line/70",
                pickerScrollable && "scroll-fade-y",
              )}
            >
              {filtered.slice(0, 40).map((recipe) => {
                const added = chosenIds.has(recipe.id);
                return (
                  <li key={recipe.id} className="flex items-center gap-2 px-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium break-words text-ink">{recipe.title}</span>
                      <span className="block truncate text-xs text-ink-soft">
                        {recipe.owner.name} · {recipe.servings} {recipe.servings === 1 ? "Portion" : "Portionen"}
                      </span>
                    </span>
                    <Button
                      variant={added ? "ghost" : "secondary"}
                      size="sm"
                      disabled={added}
                      className="shrink-0 px-2 sm:px-3"
                      aria-label={`${recipe.title} hinzufügen`}
                      onClick={() => add(recipe)}
                    >
                      {added ? (
                        <>
                          <Check className="size-4" />
                          <span className="sr-only sm:not-sr-only">Gewählt</span>
                        </>
                      ) : (
                        <>
                          <Plus className="size-4" />
                          <span className="sr-only sm:not-sr-only">Hinzufügen</span>
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {filtered.length > 40 && (
            <p className="mt-2 text-xs text-ink-soft">
              Es werden die ersten 40 Treffer gezeigt. Verfeinere die Suche.
            </p>
          )}

          {selection.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Deine Auswahl</p>
              {selection.map((item) => (
                <div
                  key={item.recipeId}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line/70 bg-paper/60 px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                    <span className="block text-xs text-ink-soft">{item.owner}</span>
                  </span>
                  <Stepper
                    value={item.servings}
                    onChange={(next) => setServings(item.recipeId, next)}
                    label={`Portionen für ${item.title}`}
                  />
                  <IconButton label={`${item.title} entfernen`} className="text-danger" onClick={() => remove(item.recipeId)}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button loading={build.isPending} disabled={selection.length === 0} onClick={() => build.mutate()}>
              Liste erstellen
            </Button>
            <span className="text-xs text-ink-soft">
              {selection.length === 0
                ? "Wähle mindestens ein Rezept."
                : `${selection.length} ${selection.length === 1 ? "Rezept" : "Rezepte"} gewählt`}
            </span>
          </div>
        </Card>

        <Card className="border-sage/30 bg-sage-soft/40 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Info className="size-4 text-sage" />
            Deine Mengen
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Hat ein Rezept eine eigene Variante von dir, nutzt die Liste deine Mengen. Sonst gelten die Mengen des
            gewählten Rezepts. Die Portionen kannst du je Rezept einstellen.
          </p>
        </Card>

        {list && (
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg">Deine Liste</h2>
              <Badge tone={checkedCount === items.length && items.length > 0 ? "sage" : "neutral"}>
                {items.length === 0 ? "leer" : `${checkedCount}/${items.length}`}
              </Badge>
            </div>
            {items.length > 0 && (
              <p className="mt-1 text-xs text-ink-soft">Zutaten von A bis Z sortiert.</p>
            )}

            {list.warnings.length > 0 && (
              <div className="mt-3 rounded-xl border border-gold/40 bg-gold/5 p-3">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <AlertTriangle className="size-4 text-gold" />
                  Hinweise
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                  {list.warnings.map((warning, index) => (
                    <li key={index}>{warningText(warning)}</li>
                  ))}
                </ul>
              </div>
            )}

            {items.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Die Liste ist leer"
                  body="Die gewählten Rezepte haben keine Zutaten. Prüfe die Rezepte oder wähle andere."
                />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line/60">
                {items.map((item) => {
                  const isChecked = checked.includes(item.key);
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isChecked}
                        onClick={() => toggle(item.key)}
                        className="tap flex min-h-12 w-full items-start gap-3 rounded-lg px-2 py-3 text-left transition hover:bg-ink/5"
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition",
                            isChecked ? "border-sage bg-sage text-white" : "border-line bg-white text-transparent",
                          )}
                        >
                          <Check className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-sm", isChecked ? "text-ink-soft line-through" : "text-ink")}>
                            {item.amount === null ? (
                              <>
                                <span className="font-medium">{item.name}</span>{" "}
                                <span className="text-ink-soft">nach Bedarf</span>
                              </>
                            ) : (
                              <>
                                <span className="font-medium">{amountText(item)}</span> {item.name}
                              </>
                            )}
                          </span>
                          {item.sources.length > 0 && (
                            <span className="mt-0.5 block truncate text-xs text-ink-soft">
                              Aus: {item.sources.join(", ")}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {!list && (
          <EmptyState
            title="Noch keine Liste"
            body="Wähle Rezepte und Portionen. Danach entsteht hier die zusammengefasste Einkaufsliste."
            icon={<ShoppingBasket className="size-8" />}
          />
        )}
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Liste leeren?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Abbrechen
            </Button>
            <Button variant="danger" onClick={clearAll}>
              Liste leeren
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          Die Liste, alle Häkchen und deine Rezeptauswahl werden entfernt. Das lässt sich nicht rückgängig machen.
        </p>
      </Modal>
    </div>
  );
}
