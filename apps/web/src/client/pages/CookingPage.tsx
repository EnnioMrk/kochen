import { useCallback, useEffect, useRef, useState } from "react";
import type { RecipeDetail, RecipeStep } from "@kochen/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChefHat,
  ChevronDown,
  Clock,
  Timer as TimerIcon,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api, qk } from "../lib/api";
import { useMe } from "../lib/session";
import { cn, errorText } from "../lib/utils";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Segmented,
  Skeleton,
  useToast,
} from "../components/ui";
import { IngredientRows, ServingsStepper } from "../components/recipes/IngredientList";
import {
  useCookingTimers,
  type CookingTimer,
} from "../components/recipes/useCookingTimers";
import { useWakeLock } from "../components/recipes/useWakeLock";
import { durationLabel, servingsLabel, timerText } from "../components/recipes/format";

function readList(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

/** Check-off lives in sessionStorage, keyed by recipe. */
function useSessionList(key: string) {
  const [items, setItems] = useState<string[]>(() => readList(key));
  const loadedKey = useRef(key);
  if (loadedKey.current !== key) {
    loadedKey.current = key;
    setItems(readList(key));
  }
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(items));
    } catch {
      // Private mode can block storage. Check-off still works in memory.
    }
  }, [key, items]);
  return [items, setItems] as const;
}

function stepIdOf(step: RecipeStep, index: number): string {
  return step.id ?? `step-${index}`;
}

const NARROW_QUERY = "(max-width: 767px)";

/** True on phone-sized viewports; mirrors the `md` breakpoint used by the layout. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(NARROW_QUERY);
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return narrow;
}

/** "0,5" or "1.5" -> seconds. Null while the field is empty or not a positive number. */
function minutesToSeconds(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value * 60));
}

function TimerControl({
  stepId,
  durationS,
  timer,
  remainingMs,
  onStart,
  onDismiss,
  startPending,
  compact,
  defaultMinutes,
}: {
  stepId: string;
  durationS: number | null | undefined;
  timer: CookingTimer | null;
  remainingMs: (timer: CookingTimer) => number;
  onStart: (stepId: string, seconds: number) => void;
  onDismiss: (timerId: string) => void;
  startPending: boolean;
  compact?: boolean;
  /**
   * Prefilled minutes for a step without a duration, e.g. the overview keeps 5.
   * Omitted in the step-by-step view: there the field starts empty behind a
   * "Timer hinzufügen" action, so no timer is ever preset.
   */
  defaultMinutes?: number;
}) {
  const [minutes, setMinutes] = useState(
    durationS
      ? String(Math.max(1, Math.round(durationS / 60)))
      : defaultMinutes !== undefined
        ? String(defaultMinutes)
        : "",
  );
  const [adding, setAdding] = useState(false);
  const enteredSeconds = minutesToSeconds(minutes);

  if (timer) {
    const left = remainingMs(timer);
    const expired = left <= 0;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          expired
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-brand/30 bg-brand/[0.07] text-brand-dark",
        )}
      >
        <TimerIcon className="size-3.5" />
        <span className="tabular-nums">
          {expired ? "Zeit abgelaufen" : timerText(left)}
        </span>
        <button
          type="button"
          aria-label={expired ? "Timer schließen" : "Timer abbrechen"}
          onClick={() => onDismiss(timer.id)}
          className="tap -my-2 -mr-2 flex size-11 items-center justify-center rounded-full hover:bg-ink/5"
        >
          <X className="size-3.5" />
        </button>
      </span>
    );
  }

  if (durationS) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={cn("min-h-11", compact && "min-h-10")}
        loading={startPending}
        onClick={() => onStart(stepId, durationS)}
      >
        <TimerIcon className="size-4" />
        Timer {durationLabel(durationS)}
      </Button>
    );
  }

  if (defaultMinutes === undefined) {
    // Step-by-step view: nothing is preset, the field opens empty.
    if (!adding) {
      return (
        <Button
          variant="secondary"
          size="sm"
          className={cn("min-h-11", compact && "min-h-10")}
          onClick={() => setAdding(true)}
        >
          <TimerIcon className="size-4" />
          Timer hinzufügen
        </Button>
      );
    }
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Input
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || enteredSeconds === null) return;
            event.preventDefault();
            onStart(stepId, enteredSeconds);
          }}
          autoFocus
          inputMode="decimal"
          placeholder="Minuten"
          aria-label="Minuten für den Timer"
          className="h-11 w-16 px-2 py-1 text-center text-sm"
        />
        <span className="text-xs text-ink-soft">Min.</span>
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11"
          disabled={enteredSeconds === null}
          loading={startPending}
          onClick={() => {
            if (enteredSeconds === null) return;
            onStart(stepId, enteredSeconds);
          }}
        >
          <TimerIcon className="size-4" />
          Start
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        value={minutes}
        onChange={(event) => setMinutes(event.target.value)}
        inputMode="decimal"
        aria-label="Minuten für den Timer"
        className="h-10 w-16 px-2 py-1 text-center text-sm"
      />
      <span className="text-xs text-ink-soft">Min.</span>
      <Button
        variant="secondary"
        size="sm"
        className="min-h-10"
        loading={startPending}
        onClick={() => {
          const value = Number(minutes.replace(",", "."));
          const fallback = Number.isFinite(value) ? value : defaultMinutes;
          onStart(stepId, Math.max(1, Math.round(fallback)) * 60);
        }}
      >
        <TimerIcon className="size-4" />
        Timer
      </Button>
    </span>
  );
}

function IngredientsPanel({
  recipe,
  servings,
  onServingsChange,
  checked,
  onToggle,
  inline,
}: {
  recipe: RecipeDetail;
  servings: number;
  onServingsChange: (next: number) => void;
  checked: string[];
  onToggle: (key: string) => void;
  inline?: boolean;
}) {
  const factor = recipe.servings > 0 ? servings / recipe.servings : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg">Zutaten</h2>
        <ServingsStepper
          value={servings}
          compact
          onChange={onServingsChange}
          base={recipe.servings}
        />
      </div>
      <IngredientRows
        ingredients={recipe.ingredients}
        factor={factor}
        checked={checked}
        onToggle={onToggle}
        inline={inline}
      />
    </div>
  );
}

export function CookingPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();

  const detail = useQuery({
    queryKey: qk.recipe(id),
    queryFn: () => api<RecipeDetail>(`/api/recipes/${id}`),
    enabled: Boolean(id),
  });
  const recipe = detail.data;

  const wake = useWakeLock(Boolean(recipe));
  const timers = useCookingTimers(id);
  const narrow = useNarrowViewport();

  const [view, setView] = useState<"steps" | "overview">(() => {
    try {
      const stored = localStorage.getItem("kochen.cookingView");
      if (stored === "steps" || stored === "overview") return stored;
    } catch {
      // Fall through to the server preference.
    }
    return "steps";
  });
  const [viewTouched, setViewTouched] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [servings, setServings] = useState<number | null>(null);
  const storageKey = `kochen.cooking:${id}`;
  const [checked, setChecked] = useSessionList(storageKey);
  const [checkedIngredients, setCheckedIngredients] = useSessionList(`${storageKey}:ingredients`);

  useEffect(() => {
    if (viewTouched) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("kochen.cookingView");
    } catch {
      stored = null;
    }
    if (stored === "steps" || stored === "overview") return;
    if (me.data?.cookingView) setView(me.data.cookingView);
  }, [me.data, viewTouched]);

  useEffect(() => {
    if (recipe && servings === null) setServings(recipe.servings);
  }, [recipe, servings]);

  const steps = recipe?.steps ?? [];
  const total = steps.length;
  const current = Math.min(stepIndex, Math.max(0, total - 1));
  const currentStep = steps[current];
  const currentKey = currentStep ? stepIdOf(currentStep, current) : "";
  const currentDone = checked.includes(currentKey);

  // Latest values for the check-off and keydown handlers, so they never act on
  // a stale closure (the keydown listener outlives a single render).
  const latest = useRef({ checked, current, currentKey, total, view, narrow });
  latest.current = { checked, current, currentKey, total, view, narrow };

  const changeView = (next: "steps" | "overview") => {
    setView(next);
    setViewTouched(true);
    try {
      localStorage.setItem("kochen.cookingView", next);
    } catch {
      // Preference stays in memory only.
    }
    void api("/api/me", { method: "PATCH", body: { cookingView: next } }).catch(
      () => {
        // Best effort: the local preference is enough.
      },
    );
  };

  const toggleStep = useCallback((stepId: string) => {
    const state = latest.current;
    const wasChecked = state.checked.includes(stepId);
    setChecked((items) =>
      items.includes(stepId)
        ? items.filter((item) => item !== stepId)
        : [...items, stepId],
    );
    // Checking never moves on desktop or in the overview; unchecking never moves.
    if (wasChecked) return;
    if (!state.narrow || state.view !== "steps") return;
    if (stepId !== state.currentKey) return;
    // The last step stays put so the finish button remains in reach.
    if (state.current >= state.total - 1) return;
    setStepIndex(state.current + 1);
  }, []);

  const finish = useMutation({
    mutationFn: () => api(`/api/recipes/${id}/cook`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.recipe(id) });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast.push("Gekocht gespeichert.", "success");
      navigate(`/rezept/${id}`);
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  useEffect(() => {
    if (view !== "steps" || !recipe || total === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setStepIndex((index) => Math.min(index + 1, total - 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === " " || event.key === "Spacebar") {
        const step = steps[current];
        if (!step) return;
        event.preventDefault();
        toggleStep(stepIdOf(step, current));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, recipe, total, current, steps, toggleStep]);

  if (!id) {
    return (
      <div className="p-6">
        <EmptyState
          title="Rezept nicht gefunden"
          body="Der Link ist unvollständig."
          action={<Button onClick={() => navigate("/")}>Zu meinen Rezepten</Button>}
        />
      </div>
    );
  }

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (detail.isError || !recipe) {
    return (
      <div className="p-6">
        <EmptyState
          title="Rezept konnte nicht geladen werden"
          body={detail.isError ? errorText(detail.error) : "Das Rezept gibt es nicht."}
          icon={<ChefHat className="size-8" />}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => navigate("/")}>Zu meinen Rezepten</Button>
              <Button variant="secondary" onClick={() => void detail.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const currentServings = servings ?? recipe.servings;
  const doneCount = steps.filter((step, index) =>
    checked.includes(stepIdOf(step, index)),
  ).length;
  const exit = () => navigate(`/rezept/${id}`);

  return (
    <div
      className="min-h-dvh pb-24"
      style={{ ["--timer-offset" as string]: timers.timers.length > 0 ? "3.5rem" : "0px" }}
    >
      <header
        className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur"
        style={{ paddingTop: "var(--safe-top)" }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
          <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={exit}>
            <ArrowLeft className="size-4" />
            <span className="sr-only sm:not-sr-only">Rezept</span>
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base text-ink">{recipe.title}</h1>
          {wake.active && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-soft">
              <span className="size-2 animate-pulse rounded-full bg-sage" aria-hidden />
              <span className="hidden md:inline">Bildschirm bleibt an</span>
              <span className="sr-only md:hidden">Bildschirm bleibt an</span>
            </span>
          )}
          <div className="order-last w-full sm:order-none sm:w-auto">
            <Segmented
              value={view}
              onChange={changeView}
              ariaLabel="Kochansicht"
              options={[
                { value: "steps", label: "Schritt für Schritt", shortLabel: "Schritte" },
                { value: "overview", label: "Alles auf einer Seite", shortLabel: "Übersicht" },
              ]}
            />
          </div>
        </div>
      </header>

      {total === 0 && (
        <div className="mx-auto max-w-3xl p-6">
          <EmptyState
            title="Keine Schritte"
            body="Dieses Rezept hat noch keine Schritte. Ergänze sie zuerst im Rezept."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={exit}>Zum Rezept</Button>
                <Button variant="sage" loading={finish.isPending} onClick={() => finish.mutate()}>
                  <Check className="size-4" />
                  Fertig gekocht
                </Button>
              </div>
            }
          />
        </div>
      )}

      {total > 0 && view === "steps" && currentStep && (
        <div className="mx-auto flex w-full max-w-4xl flex-col px-4 pb-4 pt-4">
          <details className="mb-3 rounded-[var(--radius-card)] border border-line bg-white/80">
            <summary className="tap flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                <ChefHat className="size-4 text-ink-soft" />
                Zutaten ({recipe.ingredients.length})
              </span>
              <ChevronDown className="size-4 text-ink-soft" />
            </summary>
            <div className="border-t border-line p-4">
              <IngredientsPanel
                recipe={recipe}
                servings={currentServings}
                onServingsChange={setServings}
                checked={checkedIngredients}
                onToggle={(key) =>
                  setCheckedIngredients((items) =>
                    items.includes(key)
                      ? items.filter((item) => item !== key)
                      : [...items, key],
                  )
                }
              />
            </div>
          </details>

          <div className="flex items-center justify-between gap-2">
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0 overflow-x-auto" aria-label="Fortschritt">
              {steps.map((step, index) => {
                const done = checked.includes(stepIdOf(step, index));
                return (
                  <button
                    key={stepIdOf(step, index)}
                    type="button"
                    aria-label={`Schritt ${index + 1}`}
                    aria-current={index === current ? "step" : undefined}
                    onClick={() => setStepIndex(index)}
                    className="tap flex size-11 shrink-0 items-center justify-center"
                  >
                    <span
                      className={cn(
                        "block h-2.5 rounded-full transition-all",
                        index === current
                          ? "w-8 bg-brand"
                          : done
                            ? "w-2.5 bg-sage"
                            : "w-2.5 bg-line",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft">
              {doneCount} von {total} erledigt
            </span>
          </div>

          <div key={current} className="cook-step cook-step-enter flex flex-1 flex-col justify-center py-6">
            <p className="text-sm font-medium tabular-nums text-ink-soft">
              Schritt {current + 1} von {total}
            </p>
            <p className="mt-3 whitespace-pre-wrap break-words text-2xl leading-snug text-ink sm:text-3xl lg:text-4xl">
              {currentStep.text}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {currentStep.durationS ? (
                <Badge>
                  <Clock className="size-3.5" />
                  {durationLabel(currentStep.durationS)}
                </Badge>
              ) : null}
              <TimerControl
                stepId={currentKey}
                durationS={currentStep.durationS}
                timer={timers.timerFor(currentKey)}
                remainingMs={timers.remainingMs}
                onStart={(stepId, seconds) => void timers.startTimer(stepId, seconds)}
                onDismiss={timers.dismiss}
                startPending={timers.startPending}
              />
            </div>
            <Button
              variant={currentDone ? "sage" : "secondary"}
              className="cook-inline-toggle mt-6 min-h-14 w-full md:w-auto"
              aria-pressed={currentDone}
              onClick={() => toggleStep(currentKey)}
            >
              <Check className="size-5" />
              {currentDone ? "Erledigt" : "Als erledigt markieren"}
            </Button>
          </div>

          <div className="cook-nav mt-2 flex items-center gap-2 md:gap-3">
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 min-w-0 flex-1 md:min-h-12"
              disabled={current === 0}
              onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
            >
              <ArrowLeft className="size-5 shrink-0" />
              <span className="truncate">Zurück</span>
            </Button>
            <Button
              variant={currentDone ? "sage" : "secondary"}
              size="sm"
              className="cook-nav-toggle min-h-11 w-11 shrink-0 px-0"
              aria-pressed={currentDone}
              aria-label={currentDone ? "Erledigt" : "Als erledigt markieren"}
              title={currentDone ? "Erledigt" : "Als erledigt markieren"}
              onClick={() => toggleStep(currentKey)}
            >
              <Check className="size-5" />
            </Button>
            {current < total - 1 ? (
              <Button
                size="sm"
                className="min-h-11 min-w-0 flex-1 md:min-h-12"
                onClick={() => setStepIndex((index) => Math.min(total - 1, index + 1))}
              >
                <span className="truncate">Weiter</span>
                <ArrowRight className="size-5 shrink-0" />
              </Button>
            ) : (
              <Button
                variant="sage"
                size="sm"
                className="min-h-11 min-w-0 flex-1 md:min-h-12"
                loading={finish.isPending}
                onClick={() => finish.mutate()}
              >
                <Check className="size-5 shrink-0" />
                <span className="truncate">
                  <span className="md:hidden">Fertig</span>
                  <span className="hidden md:inline">Fertig gekocht</span>
                </span>
              </Button>
            )}
          </div>
          <p className="cook-nav-hint mt-2 hidden text-center text-xs text-ink-soft md:block">
            Pfeiltasten wechseln den Schritt. Leertaste hakt ihn ab.
          </p>
        </div>
      )}

      {total > 0 && view === "overview" && (
        <div className="mx-auto w-full max-w-6xl px-4 pb-4 pt-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="min-w-0 space-y-3">
              <details className="rounded-[var(--radius-card)] border border-line bg-white/80 lg:hidden">
                <summary className="tap flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    <ChefHat className="size-4 text-ink-soft" />
                    Zutaten ({recipe.ingredients.length})
                  </span>
                  <ChevronDown className="size-4 text-ink-soft" />
                </summary>
                <div className="border-t border-line p-4">
                  <IngredientsPanel
                    recipe={recipe}
                    servings={currentServings}
                    onServingsChange={setServings}
                    checked={checkedIngredients}
                    onToggle={(key) =>
                      setCheckedIngredients((items) =>
                        items.includes(key)
                          ? items.filter((item) => item !== key)
                          : [...items, key],
                      )
                    }
                  />
                </div>
              </details>
              <Card className="hidden p-4 lg:block">
                <IngredientsPanel
                  recipe={recipe}
                  servings={currentServings}
                  onServingsChange={setServings}
                  checked={checkedIngredients}
                  inline
                  onToggle={(key) =>
                    setCheckedIngredients((items) =>
                      items.includes(key)
                        ? items.filter((item) => item !== key)
                        : [...items, key],
                    )
                  }
                />
              </Card>
              <p className="text-xs text-ink-soft">
                Mengen für {servingsLabel(currentServings)}. Nur zur Anzeige.
              </p>
            </aside>

            <ol className="min-w-0 space-y-2.5">
              {steps.map((step, index) => {
                const stepId = stepIdOf(step, index);
                const done = checked.includes(stepId);
                return (
                  <li
                    key={stepId}
                    className={cn(
                      "rounded-[var(--radius-card)] border border-line bg-white/80 p-4 transition",
                      done && "opacity-60",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        aria-pressed={done}
                        aria-label={`Schritt ${index + 1} ${done ? "erledigt" : "offen"}`}
                        onClick={() => toggleStep(stepId)}
                        className={cn(
                          "tap mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition",
                          done
                            ? "border-sage bg-sage text-white"
                            : "border-line bg-white text-ink-soft",
                        )}
                      >
                        {done ? <Check className="size-5" /> : index + 1}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-ink">
                          {step.text}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {step.durationS ? (
                            <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                              <Clock className="size-3.5" />
                              {durationLabel(step.durationS)}
                            </span>
                          ) : null}
                          <TimerControl
                            stepId={stepId}
                            durationS={step.durationS}
                            timer={timers.timerFor(stepId)}
                            remainingMs={timers.remainingMs}
                            onStart={(timerStepId, seconds) =>
                              void timers.startTimer(timerStepId, seconds)
                            }
                            onDismiss={timers.dismiss}
                            startPending={timers.startPending}
                            defaultMinutes={5}
                            compact
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-white/80 px-4 py-3">
            <span className="text-sm text-ink-soft">
              {doneCount} von {total} Schritten erledigt
            </span>
            <Button variant="sage" loading={finish.isPending} onClick={() => finish.mutate()}>
              <Check className="size-4" />
              Fertig gekocht
            </Button>
          </div>
        </div>
      )}

      {timers.timers.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur"
          style={{ paddingBottom: "calc(0.5rem + var(--safe-bottom))" }}
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-3 pt-2">
            {timers.timers.map((timer) => {
              const left = timers.remainingMs(timer);
              const expired = left <= 0;
              return (
                <div
                  key={timer.id}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
                    expired
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-line bg-white text-ink",
                  )}
                >
                  <TimerIcon className="size-4" />
                  <span className="font-medium tabular-nums">
                    {expired ? "Zeit abgelaufen" : timerText(left)}
                  </span>
                  <button
                    type="button"
                    aria-label="Timer schließen"
                    onClick={() => timers.dismiss(timer.id)}
                    className="tap -my-2 -mr-2 flex size-11 items-center justify-center rounded-full hover:bg-ink/5"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
