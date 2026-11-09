import { useState, type FormEvent } from "react";
import type { RecipeInput, UnitKey } from "@kochen/contracts";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button, Card, Field, IconButton, Input, Select, Textarea } from "../ui";

const UNITS: Array<{ value: UnitKey; label: string }> = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "l" },
  { value: "tl", label: "TL" },
  { value: "el", label: "EL" },
  { value: "stueck", label: "Stück" },
  { value: "prise", label: "Prise" },
  { value: "bund", label: "Bund" },
  { value: "dose", label: "Dose" },
  { value: "packung", label: "Packung" },
  { value: "zehe", label: "Zehe" },
  { value: "scheibe", label: "Scheibe" },
  { value: "tasse", label: "Tasse" },
  { value: "min", label: "Min." },
];

type IngredientForm = { amount: string; unit: UnitKey | ""; name: string; note: string };
type StepForm = { text: string; minutes: string };
type FormState = {
  title: string;
  description: string;
  servings: string;
  ingredients: IngredientForm[];
  steps: StepForm[];
  tags: string;
};

function parseAmount(value: string): number | null {
  const clean = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const fraction = clean.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const top = Number(fraction[1]);
    const bottom = Number(fraction[2]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0 || top <= 0) return null;
    return top / bottom;
  }
  const amount = Number(clean);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function toForm(draft: RecipeInput): FormState {
  return {
    title: draft.title,
    description: draft.description ?? "",
    servings: String(draft.servings),
    ingredients: draft.ingredients.map((ingredient) => ({
      amount: ingredient.amount === null ? "" : String(ingredient.amount).replace(".", ","),
      unit: ingredient.unit ?? "",
      name: ingredient.name,
      note: ingredient.note ?? "",
    })),
    steps: draft.steps.map((step) => ({
      text: step.text,
      minutes: step.durationS ? String(Math.round((step.durationS / 60) * 10) / 10).replace(".", ",") : "",
    })),
    tags: draft.tagNames.join(", "),
  };
}

const WARNING_TEXT: Record<string, string> = {
  titel_fehlt: "Der Titel fehlt. Bitte ergänze ihn.",
  portionen_fehlen: "Die Portionszahl fehlt. Bitte ergänze sie.",
  zu_viele_zutaten: "Es wurden sehr viele Zutaten erkannt. Prüfe die Liste.",
  zu_viele_schritte: "Es wurden sehr viele Schritte erkannt. Prüfe die Liste.",
  kein_rezept_gefunden:
    "Im Bild wurde kein klares Rezept erkannt. Prüfe den Entwurf oder reiche einen Screenshot nach.",
  schema_reparatur: "Die Antwort der KI war nicht ganz sauber. Prüfe die Angaben besonders sorgfältig.",
};

export function warningText(warning: string): string {
  return WARNING_TEXT[warning] ?? warning;
}

function buildInput(form: FormState, draft: RecipeInput): RecipeInput | string {  const title = form.title.trim();
  if (!title) return "Bitte gib einen Titel ein.";
  if (title.length > 200) return "Der Titel ist zu lang (höchstens 200 Zeichen).";

  const servings = Number.parseInt(form.servings, 10);
  if (!Number.isFinite(servings) || servings < 1 || servings > 100) {
    return "Portionen müssen zwischen 1 und 100 liegen.";
  }

  for (const ingredient of form.ingredients) {
    if (!ingredient.name.trim() && ingredient.amount.trim()) {
      return "Eine Zutat hat eine Menge, aber keine Bezeichnung.";
    }
    if (ingredient.name.trim().length > 200) {
      return "Ein Zutatenname ist zu lang (höchstens 200 Zeichen).";
    }
    if (ingredient.amount.trim() && parseAmount(ingredient.amount) === null) {
      return `Die Menge „${ingredient.amount.trim()}“ ist ungültig. Schreibe zum Beispiel 1,5.`;
    }
  }

  for (const step of form.steps) {
    if (step.text.trim().length > 4000) return "Ein Schritt ist zu lang (höchstens 4000 Zeichen).";
    if (step.minutes.trim() && (parseAmount(step.minutes) === null || (parseAmount(step.minutes) ?? 0) > 1440)) {
      return "Eine Dauer ist ungültig. Gib Minuten zwischen 1 und 1440 an.";
    }
  }

  const tagNames: string[] = [];
  for (const raw of form.tags.split(",")) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > 60) return "Ein Tag ist zu lang (höchstens 60 Zeichen).";
    if (!tagNames.includes(tag)) tagNames.push(tag);
  }
  if (tagNames.length > 30) return "Es sind höchstens 30 Tags erlaubt.";

  const ingredients = form.ingredients
    .filter((ingredient) => ingredient.name.trim().length > 0)
    .map((ingredient, position) => ({
      position,
      amount: parseAmount(ingredient.amount),
      unit: ingredient.unit === "" ? null : ingredient.unit,
      name: ingredient.name.trim(),
      note: ingredient.note.trim() || null,
    }));

  const steps = form.steps
    .filter((step) => step.text.trim().length > 0)
    .map((step, position) => {
      const minutes = parseAmount(step.minutes);
      return {
        position,
        text: step.text.trim(),
        durationS: minutes === null ? null : Math.round(minutes * 60),
      };
    });

  return {
    ...draft,
    title,
    description: form.description.trim() || null,
    servings,
    ingredients,
    steps,
    tagNames,
  };
}

export function DraftForm({
  draft,
  warnings,
  submitting,
  error,
  onSubmit,
}: {
  draft: RecipeInput;
  warnings: string[];
  submitting: boolean;
  error: string | null;
  onSubmit: (input: RecipeInput) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(draft));
  const [localError, setLocalError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const updateIngredient = (index: number, patch: Partial<IngredientForm>) => {
    setForm((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient, itemIndex) =>
        itemIndex === index ? { ...ingredient, ...patch } : ingredient,
      ),
    }));
  };

  const updateStep = (index: number, patch: Partial<StepForm>) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, itemIndex) => (itemIndex === index ? { ...step, ...patch } : step)),
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = buildInput(form, draft);
    if (typeof result === "string") {
      setLocalError(result);
      return;
    }
    setLocalError(null);
    onSubmit(result);
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {warnings.length > 0 && (
        <Card className="border-gold/40 bg-gold/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <AlertTriangle className="size-4 text-gold" />
            Bitte prüfe diese Hinweise
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
            {warnings.map((warning, index) => (
              <li key={index}>{warningText(warning)}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-4 p-4 sm:p-5">
        <Field label="Titel">
          <Input
            value={form.title}
            maxLength={200}
            onChange={(event) => update({ title: event.target.value })}
            placeholder="Name des Gerichts"
          />
        </Field>
        <Field label="Beschreibung" hint="Kurz erklären, worum es geht. Kann leer bleiben.">
          <Textarea
            value={form.description}
            maxLength={4000}
            rows={3}
            onChange={(event) => update({ description: event.target.value })}
          />
        </Field>
        <Field label="Portionen" className="max-w-40">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={form.servings}
            onChange={(event) => update({ servings: event.target.value })}
          />
        </Field>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Zutaten</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => update({ ingredients: [...form.ingredients, { amount: "", unit: "", name: "", note: "" }] })}
          >
            <Plus className="size-4" />
            Zutat hinzufügen
          </Button>
        </div>
        {form.ingredients.length === 0 ? (
          <p className="text-sm text-ink-soft">Noch keine Zutaten erkannt. Du kannst sie hier ergänzen.</p>
        ) : (
          <div className="space-y-3">
            {form.ingredients.map((ingredient, index) => (
              <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_8rem_1fr_auto] sm:items-start">
                <Input
                  value={ingredient.amount}
                  inputMode="decimal"
                  maxLength={20}
                  aria-label={`Menge für Zutat ${index + 1}`}
                  placeholder="Menge"
                  onChange={(event) => updateIngredient(index, { amount: event.target.value })}
                />
                <Select
                  value={ingredient.unit}
                  aria-label={`Einheit für Zutat ${index + 1}`}
                  onChange={(event) => updateIngredient(index, { unit: event.target.value as UnitKey | "" })}
                >
                  <option value="">ohne Einheit</option>
                  {UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </Select>
                <Input
                  className="col-span-2 sm:col-span-1"
                  value={ingredient.name}
                  maxLength={200}
                  aria-label={`Zutat ${index + 1}`}
                  placeholder="Zutat"
                  onChange={(event) => updateIngredient(index, { name: event.target.value })}
                />
                <IconButton
                  type="button"
                  label={`Zutat ${index + 1} entfernen`}
                  className="col-span-2 justify-self-end text-danger sm:col-span-1 sm:justify-self-auto"
                  onClick={() =>
                    update({ ingredients: form.ingredients.filter((_, itemIndex) => itemIndex !== index) })
                  }
                >
                  <Trash2 className="size-4" />
                </IconButton>
                <Input
                  className="col-span-2 text-sm sm:col-span-3 sm:col-start-1"
                  value={ingredient.note}
                  maxLength={300}
                  aria-label={`Hinweis für Zutat ${index + 1}`}
                  placeholder="Hinweis (optional), z. B. fein gehackt"
                  onChange={(event) => updateIngredient(index, { note: event.target.value })}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Schritte</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => update({ steps: [...form.steps, { text: "", minutes: "" }] })}
          >
            <Plus className="size-4" />
            Schritt hinzufügen
          </Button>
        </div>
        {form.steps.length === 0 ? (
          <p className="text-sm text-ink-soft">Noch keine Schritte erkannt. Du kannst sie hier ergänzen.</p>
        ) : (
          <div className="space-y-3">
            {form.steps.map((step, index) => (
              <div key={index} className="rounded-xl border border-line/70 bg-paper/50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">Schritt {index + 1}</span>
                  <IconButton
                    type="button"
                    label={`Schritt ${index + 1} entfernen`}
                    className="text-danger"
                    onClick={() => update({ steps: form.steps.filter((_, itemIndex) => itemIndex !== index) })}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
                <Textarea
                  value={step.text}
                  rows={3}
                  maxLength={4000}
                  aria-label={`Text für Schritt ${index + 1}`}
                  onChange={(event) => updateStep(index, { text: event.target.value })}
                />
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    className="w-24"
                    value={step.minutes}
                    inputMode="decimal"
                    aria-label={`Dauer für Schritt ${index + 1} in Minuten`}
                    placeholder="Min."
                    onChange={(event) => updateStep(index, { minutes: event.target.value })}
                  />
                  <span className="text-xs text-ink-soft">Minuten (optional)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <Field label="Tags" hint="Mehrere Tags mit Komma trennen, z. B. vegetarisch, schnell">
          <Input
            value={form.tags}
            maxLength={1900}
            onChange={(event) => update({ tags: event.target.value })}
            placeholder="vegetarisch, schnell"
          />
        </Field>
      </Card>

      {(localError || error) && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {localError ?? error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" loading={submitting}>
          Rezept speichern
        </Button>
        <span className="text-xs text-ink-soft">Du kannst die Angaben vor dem Speichern frei ändern.</span>
      </div>
    </form>
  );
}
