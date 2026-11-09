import { RecipeInput } from "@kochen/contracts";
import type { Ingredient, RecipeInput as RecipeInputType, RecipeStep, Visibility } from "@kochen/contracts";

export type RawDraft = {
  title?: unknown;
  description?: unknown;
  servings?: unknown;
  ingredients?: unknown;
  steps?: unknown;
  tags?: unknown;
  category?: unknown;
  sourceLang?: unknown;
  sourceType?: unknown;
  sourceUrl?: unknown;
  rawText?: unknown;
  transcript?: unknown;
};

export type NormalizedDraft = {
  recipe: RecipeInputType;
  warnings: string[];
  asksForScreenshot: boolean;
  sourceLang: string | null;
};

const UNIT_ALIASES: Record<string, string> = {
  g: "g", gr: "g", gramm: "g", grams: "g", gram: "g",
  kg: "kg", kilogramm: "kg", kilo: "kg",
  ml: "ml", milliliter: "ml", millilitre: "ml", mls: "ml",
  l: "l", liter: "l", litre: "l",
  tl: "tl", tsp: "tl", teeloeffel: "tl", "teelöffel": "tl", teaspoon: "tl",
  el: "el", tbsp: "el", essloeffel: "el", "esslöffel": "el", tablespoon: "el",
  stueck: "stueck", "stück": "stueck", st: "stueck", piece: "stueck", pieces: "stueck", pcs: "stueck",
  prise: "prise", prisen: "prise", pinch: "prise", pinches: "prise",
  bund: "bund", bunch: "bund",
  dose: "dose", dosen: "dose", can: "dose", cans: "dose",
  packung: "packung", packungen: "packung", pack: "packung", package: "packung",
  zehe: "zehe", zehen: "zehe", clove: "zehe", cloves: "zehe",
  scheibe: "scheibe", scheiben: "scheibe", slice: "scheibe", slices: "scheibe",
  tasse: "tasse", tassen: "tasse", cup: "tasse", cups: "tasse",
};

export function normalizeUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[key] ?? null;
}

/** Parse "1/2", "1,5", "1 1/2", "½", "ca. 200". Never NaN. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  let text = value.trim().toLowerCase().replace(/^ca\.?\s*/, "").replace(/\s+/g, " ");
  text = text.replace(",", ".");
  const glyphs: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  for (const [glyph, amount] of Object.entries(glyphs)) {
    if (text.includes(glyph)) {
      text = text.replace(glyph, ` ${amount} `);
    }
  }
  text = text.trim();
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den > 0) return whole + num / den;
  }
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    return den > 0 ? Number(fraction[1]) / den : null;
  }
  const number = text.match(/^(\d+(?:\.\d+)?)/);
  if (number) {
    const parsed = Number(number[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeIngredient(raw: unknown, position: number): Ingredient | null {
  if (typeof raw === "string") {
    const name = raw.trim();
    return name ? { position, amount: null, unit: null, name: name.slice(0, 200), note: null } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const name = cleanText(item.name ?? item.ingredient ?? item.item, 200);
  if (!name) return null;
  const unit = normalizeUnit(item.unit ?? item.einheit);
  const amount = parseAmount(item.amount ?? item.menge ?? item.quantity);
  const note = cleanText(item.note ?? item.hinweis, 300);
  return {
    position,
    amount,
    unit: unit as Ingredient["unit"],
    name,
    note,
  };
}

function normalizeStep(raw: unknown, position: number): RecipeStep | null {
  if (typeof raw === "string") {
    const text = raw.trim();
    return text ? { position, text: text.slice(0, 4000), durationS: null } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const text = cleanText(item.text ?? item.step ?? item.instruction ?? item.description, 4000);
  if (!text) return null;
  let durationS: number | null = null;
  if (typeof item.durationS === "number" && item.durationS > 0) durationS = Math.round(item.durationS);
  else if (typeof item.duration === "number" && item.duration > 0) durationS = Math.round(item.duration * 60);
  else if (typeof item.duration === "string") {
    const minutes = parseAmount(item.duration);
    if (minutes) durationS = Math.round(minutes * 60);
  }
  return { position, text, durationS };
}

const MAX_INGREDIENTS = 200;
const MAX_STEPS = 100;

/**
 * Turn one loose AI or user draft into the fixed recipe shape.
 * German only is enforced by the caller; this step is language neutral.
 */
export function normalizeDraft(raw: RawDraft, options?: { visibility?: Visibility }): NormalizedDraft {
  const warnings: string[] = [];
  const title = cleanText(raw.title, 200);
  if (!title) warnings.push("titel_fehlt");

  const servingsRaw = parseAmount(raw.servings);
  const servings = servingsRaw && servingsRaw >= 1 ? Math.min(100, Math.round(servingsRaw)) : 4;
  if (!servingsRaw) warnings.push("portionen_fehlen");

  const rawIngredients = asArray(raw.ingredients);
  const ingredients: Ingredient[] = [];
  rawIngredients.slice(0, MAX_INGREDIENTS).forEach((entry, index) => {
    const item = normalizeIngredient(entry, ingredients.length);
    if (item) ingredients.push(item);
  });
  if (rawIngredients.length > MAX_INGREDIENTS) warnings.push("zu_viele_zutaten");

  const rawSteps = asArray(raw.steps);
  const steps: RecipeStep[] = [];
  rawSteps.slice(0, MAX_STEPS).forEach((entry) => {
    const item = normalizeStep(entry, steps.length);
    if (item) steps.push(item);
  });
  if (rawSteps.length > MAX_STEPS) warnings.push("zu_viele_schritte");

  const tags = [...new Set(
    asArray(raw.tags)
      .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""))
      .filter(Boolean)
      .slice(0, 30),
  )];

  const sourceLang = typeof raw.sourceLang === "string" ? raw.sourceLang.slice(0, 16) : null;
  const asksForScreenshot = ingredients.length === 0 && steps.length === 0;
  if (asksForScreenshot) warnings.push("kein_rezept_gefunden");

  const candidate = {
    title: title ?? "",
    description: cleanText(raw.description, 4000),
    servings,
    ingredients: ingredients.map((item, index) => ({ ...item, position: index })),
    steps: steps.map((item, index) => ({ ...item, position: index })),
    sourceType: "text" as const,
    sourceUrl: null,
    rawText: cleanText(raw.rawText, 200_000),
    transcript: cleanText(raw.transcript, 200_000),
    originalLang: sourceLang,
    visibility: options?.visibility ?? ("friends" as Visibility),
    tagNames: tags,
    categoryIds: [],
  };

  // Last line of defense: the contract stays valid even for a broken model answer.
  const parsed = RecipeInput.safeParse(candidate);
  if (!parsed.success) {
    warnings.push("schema_reparatur");
    return {
      recipe: {
        ...candidate,
        title: candidate.title || "Unbenanntes Rezept",
      },
      warnings: [...new Set([...warnings, ...parsed.error.issues.map((i) => `feld:${i.path.join(".")}`)])],
      asksForScreenshot,
      sourceLang,
    };
  }
  return { recipe: parsed.data, warnings: [...new Set(warnings)], asksForScreenshot, sourceLang };
}
