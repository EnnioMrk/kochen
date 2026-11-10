import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Category, RecipeDetail, Tag, UnitKey } from "@kochen/contracts";
import { DEFAULT_LIMITS } from "@kochen/contracts";
import { UNITS } from "@kochen/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronLeft,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { api, qk } from "../lib/api";
import { cn, errorText } from "../lib/utils";
import {
  checkFiles,
  unreadableFileMessage,
  uploadErrorMessage,
  uploadFiles,
} from "../components/capture/upload";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  RowMenu,
  RowMenuItem,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "../components/ui";

const FIELD_LABEL: Record<string, string> = {
  title: "Titel",
  description: "Beschreibung",
  servings: "Portionen",
  bakingTemperature: "Backtemperatur",
  bakingTime: "Backzeit",
  tagNames: "Tags",
  categoryIds: "Kategorien",
};

const LINE_FIELD: Record<string, string> = {
  name: "Name",
  amount: "Menge",
  unit: "Einheit",
  note: "Notiz",
  text: "Text",
  minutes: "Dauer",
};

/** Names the field in a validation message, so the toast points at the cause. */
function errorLabel(path: string): string {
  const [root = "", index, field] = path.split(".");
  if (root === "ingredients") {
    const line = `Zutat ${Number(index) + 1}`;
    return field ? `${line} – ${LINE_FIELD[field] ?? field}` : line;
  }
  if (root === "steps") {
    const line = `Schritt ${Number(index) + 1}`;
    return field ? `${line} – ${LINE_FIELD[field] ?? field}` : line;
  }
  return FIELD_LABEL[root] ?? root;
}

function firstError(errors: unknown): { label: string; message: string } | null {
  const walk = (node: unknown, path: string): { label: string; message: string } | null => {
    if (!node || typeof node !== "object") return null;
    const record = node as { message?: unknown } & Record<string, unknown>;
    if (typeof record.message === "string" && record.message) {
      return { label: errorLabel(path), message: record.message };
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "ref" || key === "type" || key === "types") continue;
      const found = walk(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return null;
  };
  return walk(errors, "");
}

/* ------------------------------------------------------------------ schema */

const numberText = (value: string) => Number(value.replace(",", ".").trim());

const formSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    servings: z.string(),
    bakingTemperature: z.string(),
    bakingTime: z.string(),
    visibility: z.enum(["private", "friends", "members"]),
    tagNames: z.array(z.string()),
    categoryIds: z.array(z.string()),
    ingredients: z.array(
      z.object({
        amount: z.string(),
        unit: z.string(),
        name: z.string(),
        note: z.string(),
        lineageKey: z.string().optional(),
      }),
    ),
    steps: z.array(
      z.object({
        text: z.string(),
        minutes: z.string(),
        lineageKey: z.string().optional(),
      }),
    ),
  })
  .superRefine((values, ctx) => {
    const title = values.title.trim();
    if (!title) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "Bitte einen Titel eingeben." });
    } else if (title.length > 200) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "Höchstens 200 Zeichen." });
    }
    if (values.description.length > 4000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["description"], message: "Höchstens 4000 Zeichen." });
    }
    if (values.bakingTemperature.trim().length > 80) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bakingTemperature"],
        message: "Höchstens 80 Zeichen.",
      });
    }
    if (values.bakingTime.trim().length > 80) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bakingTime"],
        message: "Höchstens 80 Zeichen.",
      });
    }
    const servings = numberText(values.servings);
    if (!Number.isInteger(servings) || servings < 1 || servings > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["servings"], message: "Bitte 1 bis 100 eingeben." });
    }
    values.ingredients.forEach((row, index) => {
      const hasContent = Boolean(
        row.name.trim() || row.amount.trim() || row.unit || row.note.trim(),
      );
      if (!hasContent) return;
      if (!row.name.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ingredients", index, "name"],
          message: "Bitte eine Zutat eingeben.",
        });
      }
      if (row.amount.trim()) {
        const amount = numberText(row.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ingredients", index, "amount"],
            message: "Bitte eine Zahl größer 0 eingeben.",
          });
        }
      }
    });
    values.steps.forEach((row, index) => {
      if (!row.text.trim() && !row.minutes.trim()) return;
      if (!row.text.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "text"],
          message: "Bitte einen Schritt eingeben.",
        });
      }
      if (row.minutes.trim()) {
        const minutes = numberText(row.minutes);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "minutes"],
            message: "Bitte Minuten größer 0 eingeben.",
          });
        }
      }
    });
  });

type FormValues = z.infer<typeof formSchema>;

const EMPTY_VALUES: FormValues = {
  title: "",
  description: "",
  servings: "4",
  bakingTemperature: "",
  bakingTime: "",
  visibility: "friends",
  tagNames: [],
  categoryIds: [],
  ingredients: [{ amount: "", unit: "", name: "", note: "" }],
  steps: [{ text: "", minutes: "" }],
};

function fromDetail(recipe: RecipeDetail): FormValues {
  return {
    title: recipe.title,
    description: recipe.description ?? "",
    servings: String(recipe.servings),
    bakingTemperature: recipe.bakingTemperature ?? "",
    bakingTime: recipe.bakingTime ?? "",
    visibility: recipe.visibility,
    tagNames: recipe.tags,
    categoryIds: recipe.categories.map((category) => category.id),
    ingredients:
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((item) => ({
            amount:
              item.amount === null ? "" : String(item.amount).replace(".", ","),
            unit: item.unit ?? "",
            name: item.name,
            note: item.note ?? "",
            lineageKey: item.lineageKey,
          }))
        : [{ amount: "", unit: "", name: "", note: "" }],
    steps:
      recipe.steps.length > 0
        ? recipe.steps.map((step) => ({
            text: step.text,
            minutes: step.durationS ? String(Math.round(step.durationS / 60)) : "",
            lineageKey: step.lineageKey,
          }))
        : [{ text: "", minutes: "" }],
  };
}

function buildLines(values: FormValues) {
  const ingredients = values.ingredients
    .filter((row) => row.name.trim())
    .map((row, index) => ({
      position: index,
      amount: row.amount.trim() ? numberText(row.amount) : null,
      unit: (row.unit ? row.unit : null) as UnitKey | null,
      name: row.name.trim(),
      note: row.note.trim() ? row.note.trim() : null,
      ...(row.lineageKey ? { lineageKey: row.lineageKey } : {}),
    }));
  const steps = values.steps
    .filter((row) => row.text.trim())
    .map((row, index) => ({
      position: index,
      text: row.text.trim(),
      durationS: row.minutes.trim()
        ? Math.max(1, Math.round(numberText(row.minutes) * 60))
        : null,
      ...(row.lineageKey ? { lineageKey: row.lineageKey } : {}),
    }));
  return {
    ingredients,
    steps,
    bakingTemperature: values.bakingTemperature.trim() || null,
    bakingTime: values.bakingTime.trim() || null,
  };
}

export function RecipeEditorPage() {
  const { id } = useParams<{ id: string }>();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [initialized, setInitialized] = useState(!editing);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [debouncedTagQuery, setDebouncedTagQuery] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const detail = useQuery({
    queryKey: qk.recipe(id ?? "new"),
    queryFn: () => api<RecipeDetail>(`/api/recipes/${id}`),
    enabled: editing && Boolean(id),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY_VALUES,
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = form;

  const ingredientFields = useFieldArray({ control, name: "ingredients" });
  const stepFields = useFieldArray({ control, name: "steps" });

  const selectedTags = watch("tagNames");
  const selectedCategories = watch("categoryIds");
  const ingredientValues = watch("ingredients");

  useEffect(() => {
    if (editing && detail.data && !initialized) {
      reset(fromDetail(detail.data));
      setInitialized(true);
    }
  }, [editing, detail.data, initialized, reset]);

  /* An existing recipe starts with filled rows folded to their summary. */
  useEffect(() => {
    if (!initialized) return;
    const rows = form.getValues("ingredients");
    const next: Record<string, boolean> = {};
    ingredientFields.fields.forEach((field, index) => {
      if (rows[index]?.name?.trim()) next[field.id] = true;
    });
    setCollapsed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTagQuery(tagQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [tagQuery]);

  const tagResults = useQuery({
    queryKey: qk.tags(debouncedTagQuery),
    queryFn: () =>
      api<Tag[]>(
        `/api/tags${
          debouncedTagQuery ? `?q=${encodeURIComponent(debouncedTagQuery)}` : ""
        }`,
      ),
    staleTime: 60_000,
  });

  const categories = useQuery({
    queryKey: qk.categories,
    queryFn: () => api<Category[]>("/api/categories"),
    staleTime: 60_000,
  });

  const createCategory = useMutation({
    mutationFn: (name: string) =>
      api<{ id: string; name: string }>("/api/categories", {
        method: "POST",
        body: { name },
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: qk.categories });
      setValue("categoryIds", [...selectedCategories, created.id], {
        shouldDirty: true,
      });
      setCategoryInput("");
      toast.push("Kategorie angelegt.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const { ingredients, steps, bakingTemperature, bakingTime } = buildLines(values);
      const shared = {
        title: values.title.trim(),
        description: values.description.trim() ? values.description.trim() : null,
        servings: Math.round(numberText(values.servings)),
        bakingTemperature,
        bakingTime,
        ingredients,
        steps,
        visibility: values.visibility,
        tagNames: values.tagNames,
        categoryIds: values.categoryIds,
      };
      if (editing && id) {
        return api<RecipeDetail>(`/api/recipes/${id}`, {
          method: "PATCH",
          body: shared,
        });
      }
      return api<RecipeDetail>("/api/recipes", {
        method: "POST",
        body: {
          ...shared,
          sourceType: "manual" as const,
          sourceUrl: null,
          rawText: null,
          transcript: null,
          originalLang: null,
        },
      });
    },
    onSuccess: async (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.recipe(saved.id) });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      if (coverFile) {
        try {
          const [key] = await uploadFiles([coverFile], "photo");
          if (!key) throw new Error("upload_failed");
          await api(`/api/recipes/${saved.id}/images`, {
            method: "POST",
            body: { key, kind: "cover", position: 0 },
          });
          void queryClient.invalidateQueries({ queryKey: qk.recipe(saved.id) });
          toast.push(editing ? "Rezept gespeichert." : "Rezept erstellt.", "success");
        } catch (error) {
          toast.push(
            `Rezept gespeichert. Das Foto fehlt: ${uploadErrorMessage(error, "upload")}`,
            "error",
          );
        }
      } else {
        toast.push(editing ? "Rezept gespeichert." : "Rezept erstellt.", "success");
      }
      navigate(`/rezept/${saved.id}`);
    },
    onError: (error) => {
      const text = errorText(error);
      setSaveError(text);
      toast.push(text, "error");
    },
  });

  const onSubmit = handleSubmit(
    (values) => {
      setSaveError(null);
      save.mutate(values);
    },
    () => {
      const first = firstError(errors);
      toast.push(
        first
          ? `${first.label}: ${first.message}`
          : "Bitte prüfe die Eingaben. Ein Feld ist noch nicht gültig.",
        "error",
      );
    },
  );

  const pickCover = (file: File | undefined) => {
    if (!file) return;
    const problem = unreadableFileMessage(file) ?? checkFiles([file], "photo", DEFAULT_LIMITS);
    if (problem) {
      toast.push(problem, "error");
      return;
    }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  useEffect(
    () => () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    },
    [coverPreview],
  );

  const addTag = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    if (clean.length > 60) {
      toast.push("Ein Tag darf höchstens 60 Zeichen haben.", "error");
      return;
    }
    const duplicate = selectedTags.some(
      (tag) => tag.toLowerCase() === clean.toLowerCase(),
    );
    if (!duplicate) {
      setValue("tagNames", [...selectedTags, clean], { shouldDirty: true });
    }
    setTagInput("");
  };

  const ingredientPath = (index: number, field: keyof FormValues["ingredients"][number]) =>
    `ingredients.${index}.${field}` as FieldPath<FormValues>;
  const stepPath = (index: number, field: keyof FormValues["steps"][number]) =>
    `steps.${index}.${field}` as FieldPath<FormValues>;

  /**
   * Prepending inserts the row at index 0. The DOM only has it after the next
   * frame, so focus its name field inside requestAnimationFrame.
   */
  const focusIngredientName = (index: number) => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(`[name="ingredients.${index}.name"]`)
        ?.focus();
    });
  };

  const addIngredient = () => {
    ingredientFields.prepend({ amount: "", unit: "", name: "", note: "" });
    focusIngredientName(0);
  };

  if (editing && (detail.isLoading || (detail.data && !initialized))) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" />
      </div>
    );
  }

  if (editing && detail.isError) {
    return (
      <EmptyState
        title="Rezept konnte nicht geladen werden"
        body={errorText(detail.error)}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" onClick={() => void detail.refetch()}>
              Erneut versuchen
            </Button>
            <Button variant="ghost" onClick={() => navigate("/")}>
              Zu meinen Rezepten
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={editing ? "Rezept bearbeiten" : "Neues Rezept"}
        subtitle={
          editing
            ? "Änderungen ersetzen die bisherigen Zutaten und Schritte."
            : "Titel, Zutaten und Schritte eintragen. Speichern nicht vergessen."
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => navigate(editing && id ? `/rezept/${id}` : "/")}
            >
              <ChevronLeft className="size-4" />
              Abbrechen
            </Button>
            <Button
              type="submit"
              form="recipe-form"
              loading={save.isPending || isSubmitting}
            >
              <Save className="size-4" />
              Speichern
            </Button>
          </>
        }
      />

      {saveError && (
        <div className="rounded-xl border border-danger/40 bg-danger/[0.07] px-4 py-3 text-sm text-ink">
          <p className="font-medium">Speichern hat nicht geklappt.</p>
          <p className="mt-0.5 text-ink-soft">{saveError}</p>
          <p className="mt-1 text-xs text-ink-soft">
            Deine Eingaben bleiben erhalten. Bitte erneut versuchen.
          </p>
        </div>
      )}

      <form id="recipe-form" onSubmit={onSubmit} className="space-y-5" noValidate>
        <Card className="space-y-4 p-5">
          <h2 className="text-xl">Grunddaten</h2>

          <Field label="Titel" error={errors.title?.message}>
            <Input
              {...register("title")}
              placeholder="Zum Beispiel: Kürbissuppe mit Ingwer"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Beschreibung"
            hint="Optional. Kurz halten."
            error={errors.description?.message}
          >
            <Textarea
              {...register("description")}
              placeholder="Was macht das Rezept besonders?"
              className="min-h-20"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Portionen"
              hint="1 bis 100"
              error={errors.servings?.message}
            >
              <Input
                {...register("servings")}
                inputMode="numeric"
                className="w-32"
              />
            </Field>
            <Field label="Sichtbarkeit">
              <Select {...register("visibility")}>
                <option value="private">Privat – nur ich</option>
                <option value="friends">Freunde</option>
                <option value="members">Alle Mitglieder</option>
              </Select>
            </Field>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink">Titelbild</span>
            <div className="flex items-center gap-3">
              <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper-2">
                {coverPreview ?? detail.data?.coverUrl ? (
                  <img
                    src={coverPreview ?? detail.data?.coverUrl ?? ""}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Camera className="size-5 text-ink-soft" aria-hidden />
                )}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverPreview
                    ? "Anderes Foto"
                    : detail.data?.coverUrl
                      ? "Foto ersetzen"
                      : "Foto wählen"}
                </Button>
                {coverPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCoverFile(null);
                      setCoverPreview(null);
                    }}
                  >
                    Auswahl verwerfen
                  </Button>
                )}
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  pickCover(file);
                }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Das Foto wird beim Speichern hochgeladen. JPG, PNG, WebP, HEIC oder GIF.
            </p>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">Zutaten</h2>
            <Button type="button" variant="secondary" size="sm" onClick={addIngredient}>
              <Plus className="size-4" />
              Zutat
            </Button>
          </div>

          {ingredientFields.fields.length === 0 && (
            <p className="text-sm text-ink-soft">Noch keine Zutaten.</p>
          )}

          <div className="space-y-2">
            {ingredientFields.fields.map((field, index) => {
              const rowError =
                errors.ingredients?.[index]?.name?.message ??
                errors.ingredients?.[index]?.amount?.message;
              const value = ingredientValues[index];
              const unitLabel = value?.unit ? UNITS[value.unit]?.label : "";
              const summary = [value?.amount, unitLabel, value?.name]
                .map((part) => part?.trim())
                .filter(Boolean)
                .join(" ");
              const open = !collapsed[field.id];
              const bodyId = `zutat-${field.id}`;
              return (
                <div
                  key={field.id}
                  className="rounded-xl border border-line/70 bg-paper/50"
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    if (!summary) return;
                    setCollapsed((current) => ({ ...current, [field.id]: true }));
                  }}
                >
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() =>
                        setCollapsed((current) => ({ ...current, [field.id]: open }))
                      }
                      className="tap-target flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-ink-soft transition-transform",
                          !open && "-rotate-90",
                        )}
                        aria-hidden
                      />
                      <span className="shrink-0 text-sm font-medium text-ink">
                        Zutat {index + 1}
                      </span>
                      {!open && (
                        <span className="min-w-0 truncate text-sm text-ink-soft">
                          {summary || "leer"}
                        </span>
                      )}
                    </button>
                    <RowMenu label={`Zutat ${index + 1}: Aktionen`}>
                      <RowMenuItem
                        disabled={index === 0}
                        onClick={() => ingredientFields.move(index, index - 1)}
                      >
                        <ArrowUp className="size-4" />
                        Nach oben
                      </RowMenuItem>
                      <RowMenuItem
                        disabled={index === ingredientFields.fields.length - 1}
                        onClick={() => ingredientFields.move(index, index + 1)}
                      >
                        <ArrowDown className="size-4" />
                        Nach unten
                      </RowMenuItem>
                      <RowMenuItem
                        className="text-danger"
                        onClick={() => ingredientFields.remove(index)}
                      >
                        <Trash2 className="size-4" />
                        Entfernen
                      </RowMenuItem>
                    </RowMenu>
                  </div>
                  {open && (
                    <div id={bodyId} className="px-3 pb-3">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-[5.5rem_8.5rem_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                        <label className="block">
                          <span className="mb-1 block text-xs text-ink-soft md:sr-only">Menge</span>
                          <Input
                            {...register(ingredientPath(index, "amount"))}
                            inputMode="decimal"
                            placeholder="Menge"
                            aria-label={`Menge Zutat ${index + 1}`}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-ink-soft md:sr-only">Einheit</span>
                          <Select
                            {...register(ingredientPath(index, "unit"))}
                            aria-label={`Einheit Zutat ${index + 1}`}
                          >
                            <option value="">ohne</option>
                            {Object.values(UNITS).map((unit) => (
                              <option key={unit.key} value={unit.key}>
                                {unit.label}
                              </option>
                            ))}
                          </Select>
                        </label>
                        <label className="col-span-2 block md:col-span-1">
                          <span className="mb-1 block text-xs text-ink-soft md:sr-only">Zutat</span>
                          <Input
                            {...register(ingredientPath(index, "name"))}
                            placeholder="Zutat"
                            aria-label={`Zutat ${index + 1}`}
                          />
                        </label>
                        <label className="col-span-2 block md:col-span-1">
                          <span className="mb-1 block text-xs text-ink-soft md:sr-only">Hinweis</span>
                          <Input
                            {...register(ingredientPath(index, "note"))}
                            placeholder="Hinweis (optional)"
                            aria-label={`Notiz Zutat ${index + 1}`}
                            className="text-sm"
                          />
                        </label>
                      </div>
                      {rowError && <p className="mt-1 text-xs text-danger">{rowError}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Backtemperatur" error={errors.bakingTemperature?.message}>
              <Input
                {...register("bakingTemperature")}
                maxLength={80}
                placeholder="z. B. 180 °C Ober-/Unterhitze"
              />
            </Field>
            <Field label="Backzeit" error={errors.bakingTime?.message}>
              <Input
                {...register("bakingTime")}
                maxLength={80}
                placeholder="z. B. 35 Min."
              />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl">Schritte</h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => stepFields.append({ text: "", minutes: "" })}
            >
              <Plus className="size-4" />
              Schritt
            </Button>
          </div>

          {stepFields.fields.length === 0 && (
            <p className="text-sm text-ink-soft">Noch keine Schritte.</p>
          )}

          <div className="divide-y divide-line/60">
            {stepFields.fields.map((field, index) => {
              const rowError =
                errors.steps?.[index]?.text?.message ??
                errors.steps?.[index]?.minutes?.message;
              return (
                <div key={field.id} className="py-3">
                  <div className="flex gap-2">
                    <span className="mt-2 flex size-7 shrink-0 items-center justify-center rounded-full bg-sage-soft text-xs font-semibold text-sage-text">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Textarea
                        {...register(stepPath(index, "text"))}
                        placeholder="Was ist zu tun?"
                        aria-label={`Schritt ${index + 1}`}
                        className="min-h-20"
                      />
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <label className="block w-40">
                          <span className="mb-1 block text-xs text-ink-soft">
                            Dauer (Min., optional)
                          </span>
                          <Input
                            {...register(stepPath(index, "minutes"))}
                            inputMode="decimal"
                            placeholder="z. B. 30"
                            aria-label={`Dauer Schritt ${index + 1} in Minuten`}
                          />
                        </label>
                        <RowMenu label={`Schritt ${index + 1}: Aktionen`}>
                          <RowMenuItem
                            disabled={index === 0}
                            onClick={() => stepFields.move(index, index - 1)}
                          >
                            <ArrowUp className="size-4" />
                            Nach oben
                          </RowMenuItem>
                          <RowMenuItem
                            disabled={index === stepFields.fields.length - 1}
                            onClick={() => stepFields.move(index, index + 1)}
                          >
                            <ArrowDown className="size-4" />
                            Nach unten
                          </RowMenuItem>
                          <RowMenuItem
                            className="text-danger"
                            onClick={() => stepFields.remove(index)}
                          >
                            <Trash2 className="size-4" />
                            Entfernen
                          </RowMenuItem>
                        </RowMenu>
                      </div>
                    </div>
                  </div>
                  {rowError && <p className="mt-1 text-xs text-danger">{rowError}</p>}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="space-y-5 p-5">
          <h2 className="text-xl">Einordnung</h2>

          <Field
            label="Tags"
            hint="Frei eingeben. Der Server nutzt ähnliche Tags wieder."
          >
            <div className="flex flex-wrap gap-1.5">
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-medium text-white"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`Tag ${tag} entfernen`}
                    className="-my-1 -mr-1 ml-0.5 flex size-6 shrink-0 items-center justify-center rounded-full transition hover:bg-white/20"
                    onClick={() =>
                      setValue(
                        "tagNames",
                        selectedTags.filter((item) => item !== tag),
                        { shouldDirty: true },
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {selectedTags.length === 0 && (
                <span className="text-xs text-ink-soft">Noch keine Tags.</span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={tagInput}
                onChange={(event) => {
                  setTagInput(event.target.value);
                  setTagQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="Tag hinzufügen"
                aria-label="Tag hinzufügen"
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => addTag(tagInput)}
              >
                Hinzufügen
              </Button>
            </div>
            {tagResults.data && tagResults.data.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tagResults.data
                  .filter(
                    (tag) =>
                      !selectedTags.some(
                        (item) => item.toLowerCase() === tag.label.toLowerCase(),
                      ),
                  )
                  .slice(0, 12)
                  .map((tag) => (
                    <button
                      key={tag.slug}
                      type="button"
                      onClick={() => addTag(tag.label)}
                      className="tap tap-target min-h-8 shrink-0 rounded-full border border-line bg-white px-2.5 text-xs text-ink-soft transition hover:border-ink/30 hover:text-ink"
                    >
                      + {tag.label}
                    </button>
                  ))}
              </div>
            )}
          </Field>

          <Field label="Kategorien">
            <div className="flex flex-wrap gap-1.5">
              {(categories.data ?? []).map((category) => {
                const active = selectedCategories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setValue(
                        "categoryIds",
                        active
                          ? selectedCategories.filter((item) => item !== category.id)
                          : [...selectedCategories, category.id],
                        { shouldDirty: true },
                      )
                    }
                    className={cn(
                      "tap tap-target min-h-9 rounded-full border px-3 text-xs font-medium transition",
                      active
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-white text-ink-soft hover:border-ink/30 hover:text-ink",
                    )}
                  >
                    {category.name}
                  </button>
                );
              })}
              {categories.isLoading && (
                <span className="text-xs text-ink-soft">Kategorien werden geladen …</span>
              )}
              {!categories.isLoading && (categories.data ?? []).length === 0 && (
                <span className="text-xs text-ink-soft">Noch keine Kategorien.</span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={categoryInput}
                onChange={(event) => setCategoryInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (categoryInput.trim()) createCategory.mutate(categoryInput.trim());
                  }
                }}
                placeholder="Neue Kategorie"
                aria-label="Neue Kategorie"
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                loading={createCategory.isPending}
                disabled={!categoryInput.trim()}
                onClick={() => createCategory.mutate(categoryInput.trim())}
              >
                Anlegen
              </Button>
            </div>
          </Field>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(editing && id ? `/rezept/${id}` : "/")}
          >
            Abbrechen
          </Button>
          <Button type="submit" loading={save.isPending || isSubmitting}>
            <Save className="size-4" />
            {editing ? "Speichern" : "Rezept erstellen"}
          </Button>
        </div>
      </form>
    </div>
  );
}
