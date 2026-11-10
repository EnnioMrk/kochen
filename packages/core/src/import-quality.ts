import type { Ingredient, RecipeStep } from "@kochen/contracts";

/* ------------------------------------------------ servings (never a silent 4) */

function countOf(value: readonly unknown[] | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (Array.isArray(value)) return value.length;
  return 0;
}

/**
 * Estimate portions from the amount of work in the draft.
 *
 * Heuristic: one portion per four "units of work", where a step counts twice
 * (a step is roughly a portion's worth of cooking, an ingredient only a part
 * of one). `clamp(round((ingredients + 2 * steps) / 4), 1, 12)`.
 *
 * The result is only used when the source does not state a serving count, and
 * the caller marks it as estimated. Never returns the old silent 4.
 */
export function estimateServings(
  ingredients: readonly unknown[] | number,
  steps: readonly unknown[] | number,
): number {
  const work = countOf(ingredients) + 2 * countOf(steps);
  const portions = Math.round(work / 4);
  return Math.min(12, Math.max(1, portions));
}

/* ------------------------------------------- ingredient order by first mention */

/** Filler words that never identify an ingredient. */
const GENERIC_WORDS = new Set([
  "oder", "und", "etwas", "nach", "sowie", "gerne", "optional", "ca",
]);

/** Unit words, so "200 g" never turns into a mention of the name part "200 g". */
const UNIT_WORDS = new Set([
  "g", "gr", "gramm", "kg", "kilo", "kilogramm", "ml", "milliliter", "l", "liter",
  "tl", "teeloeffel", "teelöffel", "el", "essloeffel", "esslöffel",
  "stueck", "stück", "st", "prise", "prisen", "bund", "dose", "dosen",
  "packung", "packungen", "zehe", "zehen", "scheibe", "scheiben", "tasse", "tassen",
  "min", "minute", "minuten", "sekunde", "sekunden", "stunde", "stunden",
]);

function mentionKeys(name: string): string[] {
  const lower = name.trim().toLowerCase();
  const keys = new Set<string>();
  if (lower.length >= 3) keys.add(lower);
  for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 4) continue;
    if (/^\d+$/.test(word)) continue;
    if (UNIT_WORDS.has(word)) continue;
    if (GENERIC_WORDS.has(word)) continue;
    keys.add(word);
  }
  return [...keys];
}

function firstMentionIndex(keys: string[], stepTexts: string[]): number | null {
  let first: number | null = null;
  for (let index = 0; index < stepTexts.length; index += 1) {
    const text = stepTexts[index] ?? "";
    if (!text) continue;
    if (keys.some((key) => text.includes(key))) {
      first = index;
      break;
    }
  }
  return first;
}

/**
 * Sort ingredients by the first step that mentions them. Ingredients no step
 * mentions keep their source order behind the used ones. Positions are
 * reassigned afterwards. The sort is stable.
 */
export function orderByFirstStepMention(
  ingredients: readonly Ingredient[],
  steps: readonly RecipeStep[],
): Ingredient[] {
  const stepTexts = steps.map((step) => (step.text ?? "").toLowerCase());
  const decorated = ingredients.map((ingredient, index) => ({
    ingredient,
    index,
    mention: firstMentionIndex(mentionKeys(ingredient.name), stepTexts),
  }));
  decorated.sort((a, b) => {
    const aMention = a.mention ?? Number.POSITIVE_INFINITY;
    const bMention = b.mention ?? Number.POSITIVE_INFINITY;
    if (aMention !== bMention) return aMention - bMention;
    return a.index - b.index;
  });
  return decorated.map((entry, position) => ({ ...entry.ingredient, position }));
}

/* ------------------------------------------------- step duration from the text */

const DURATION_PATTERN =
  /(?<![\d,.])(\d+(?:[.,]\d+)?)(?:\s*(?:[-–—]|bis)\s*(\d+(?:[.,]\d+)?))?\s*(sekunden|sekunde|sek|minuten|minute|mins|min|stunden|stunde|std|h)\b/gi;

function durationFactor(word: string): number {
  const unit = word.toLowerCase();
  if (unit.startsWith("sek")) return 1;
  if (unit.startsWith("min")) return 60;
  return 3600;
}

/**
 * Read a duration the step text states ("20 Minuten kühlen", "ca. 10 Min.",
 * "1 Stunde", "90 Sekunden", "2-3 Minuten"). A range takes the lower bound.
 * Returns seconds, or null when the text names no duration.
 */
export function durationFromStepText(text: string): number | null {
  if (typeof text !== "string" || !text) return null;
  DURATION_PATTERN.lastIndex = 0;
  const match = DURATION_PATTERN.exec(text);
  if (!match) return null;
  const lower = Number(String(match[1]).replace(",", "."));
  const unitWord = match[3] ?? "";
  if (!Number.isFinite(lower) || lower <= 0) return null;
  return Math.round(lower * durationFactor(unitWord));
}

/* ------------------------------------------------------------ baking detection */

const TEMPERATURE_PATTERN = /(?<![\d,.])(\d{2,3})\s*(?:°\s*C|grad(?:\s+cel[sz]ius)?)/gi;
const MINUTES_PATTERN = /(?<![\d,.])(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*min(?:uten|\.)?/gi;
const BAKING_CONTEXT = /back|vorheiz|ofen|gebacken/i;

const HEAT_MODES: Array<[RegExp, string]> = [
  [/ober[\s\-/]*unter[\s\-]*hitze/i, "Ober-/Unterhitze"],
  [/hei(?:ß|ss)luft/i, "Heißluft"],
  [/umluft/i, "Umluft"],
  [/oberhitze/i, "Oberhitze"],
  [/unterhitze/i, "Unterhitze"],
];

function heatModeNear(text: string, start: number, end: number): string | null {
  const from = Math.max(0, start - 40);
  const to = Math.min(text.length, end + 60);
  const window = text.slice(from, to);
  for (const [pattern, label] of HEAT_MODES) {
    if (pattern.test(window)) return label;
  }
  return null;
}

function contextNear(text: string, start: number, end: number, radius = 120): string {
  return text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius));
}

function findBakingTemperature(text: string): string | null {
  TEMPERATURE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPERATURE_PATTERN.exec(text)) !== null) {
    const degrees = Number(match[1]);
    if (!Number.isFinite(degrees) || degrees < 50 || degrees > 300) continue;
    if (!BAKING_CONTEXT.test(contextNear(text, match.index, match.index + match[0].length))) continue;
    const mode = heatModeNear(text, match.index, match.index + match[0].length);
    return `${degrees} °C${mode ? ` ${mode}` : ""}`.slice(0, 80);
  }
  return null;
}

function findBakingTime(text: string): string | null {
  MINUTES_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MINUTES_PATTERN.exec(text)) !== null) {
    const lower = Number(match[1]);
    if (!Number.isFinite(lower) || lower <= 0 || lower > 300) continue;
    if (!BAKING_CONTEXT.test(contextNear(text, match.index, match.index + match[0].length, 80))) continue;
    const upper = match[2] ? Number(match[2]) : null;
    if (upper && Number.isFinite(upper) && upper > lower) return `${lower}–${upper} Min.`.slice(0, 80);
    return `${lower} Min.`.slice(0, 80);
  }
  return null;
}

/**
 * Find baking temperature and time in any of the given texts.
 *
 * Deterministic and conservative: the temperature needs a 2-3 digit number
 * right next to °C/Grad *and* a baking word (backen/Backofen/vorheizen)
 * nearby, so "180 g Mehl" or a room temperature note never counts. The time
 * needs minutes next to a baking word. Anything unsure stays null.
 */
export function detectBaking(...texts: string[]): {
  bakingTemperature: string | null;
  bakingTime: string | null;
} {
  let bakingTemperature: string | null = null;
  let bakingTime: string | null = null;
  for (const raw of texts) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const text = raw.replace(/\s+/g, " ");
    if (!bakingTemperature) bakingTemperature = findBakingTemperature(text);
    if (!bakingTime) bakingTime = findBakingTime(text);
    if (bakingTemperature && bakingTime) break;
  }
  return { bakingTemperature, bakingTime };
}
