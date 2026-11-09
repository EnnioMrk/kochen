import { Fraction } from "fraction.js";

export type UnitDef = {
  key: string;
  label: string;
  plural: string;
  dimension: "mass" | "volume" | "count" | "time";
  /** Factor to the dimension base (g, ml, piece, s). */
  factor: number;
  /** Smallest practical step for this unit. */
  roundStep: number;
  /** Units with the same merge group merge in the shopping list. */
  mergeGroup: string;
};

export const UNITS: Record<string, UnitDef> = {
  g: { key: "g", label: "g", plural: "g", dimension: "mass", factor: 1, roundStep: 5, mergeGroup: "mass" },
  kg: { key: "kg", label: "kg", plural: "kg", dimension: "mass", factor: 1000, roundStep: 0.05, mergeGroup: "mass" },
  ml: { key: "ml", label: "ml", plural: "ml", dimension: "volume", factor: 1, roundStep: 10, mergeGroup: "volume" },
  l: { key: "l", label: "l", plural: "l", dimension: "volume", factor: 1000, roundStep: 0.05, mergeGroup: "volume" },
  tl: { key: "tl", label: "TL", plural: "TL", dimension: "volume", factor: 5, roundStep: 0.25, mergeGroup: "teaspoon" },
  el: { key: "el", label: "EL", plural: "EL", dimension: "volume", factor: 15, roundStep: 0.5, mergeGroup: "tablespoon" },
  stueck: { key: "stueck", label: "Stück", plural: "Stück", dimension: "count", factor: 1, roundStep: 0.5, mergeGroup: "count" },
  prise: { key: "prise", label: "Prise", plural: "Prisen", dimension: "count", factor: 1, roundStep: 0.5, mergeGroup: "pinch" },
  bund: { key: "bund", label: "Bund", plural: "Bund", dimension: "count", factor: 1, roundStep: 0.5, mergeGroup: "bunch" },
  dose: { key: "dose", label: "Dose", plural: "Dosen", dimension: "count", factor: 1, roundStep: 0.5, mergeGroup: "can" },
  packung: { key: "packung", label: "Packung", plural: "Packungen", dimension: "count", factor: 1, roundStep: 0.5, mergeGroup: "pack" },
  zehe: { key: "zehe", label: "Zehe", plural: "Zehen", dimension: "count", factor: 1, roundStep: 0.25, mergeGroup: "clove" },
  scheibe: { key: "scheibe", label: "Scheibe", plural: "Scheiben", dimension: "count", factor: 1, roundStep: 0.5, mergeGroup: "slice" },
  tasse: { key: "tasse", label: "Tasse", plural: "Tassen", dimension: "volume", factor: 200, roundStep: 0.25, mergeGroup: "cup" },
  min: { key: "min", label: "Min.", plural: "Min.", dimension: "time", factor: 60, roundStep: 1, mergeGroup: "time" },
};

export function unitOf(key: string | null | undefined): UnitDef | null {
  if (!key) return null;
  return UNITS[key] ?? null;
}

export function unitLabel(key: string | null | undefined, amount?: number | null): string {
  const u = unitOf(key);
  if (!u) return "";
  if (amount !== undefined && amount !== null && amount === 1) return u.label;
  return u.plural;
}

function roundToStep(value: number, step: number): number {
  const out = Math.round(value / step) * step;
  // Kill floating point noise such as 4.500000000000001.
  return Math.round(out * 1000) / 1000;
}

/**
 * Scale one ingredient amount for a servings change.
 * Rational arithmetic, then a practical step per unit.
 * Count units never go below their step, so no one third of an egg.
 */
export function scaleAmount(amount: number, unit: string | null, factor: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(factor) || factor <= 0) return amount;
  const raw = new Fraction(amount).mul(new Fraction(factor)).valueOf();
  const def = unitOf(unit);
  const step = def?.roundStep ?? 0.25;
  const scaled = roundToStep(raw, step);
  if (def && (def.dimension === "count" || def.dimension === "mass" || def.dimension === "volume")) {
    return Math.max(step, scaled);
  }
  return Math.max(0, scaled);
}

/** Promote 1250 g to 1.25 kg and 1500 ml to 1.5 l for display. */
export function presentAmount(
  amount: number,
  unit: string | null,
): { amount: number; unit: string | null } {
  if (!unit) return { amount, unit };
  if (unit === "g" && amount >= 1000) {
    return { amount: roundToStep(amount / 1000, 0.05), unit: "kg" };
  }
  if (unit === "ml" && amount >= 1000) {
    return { amount: roundToStep(amount / 1000, 0.05), unit: "l" };
  }
  return { amount, unit };
}

const FRACTIONS: Array<[number, string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

function fractionGlyph(value: number): string | null {
  for (const [v, g] of FRACTIONS) {
    if (Math.abs(value - v) < 0.001) return g;
  }
  return null;
}

/** German amount text: `1 ½`, `0,5`, `250`. */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs + 1e-9);
  const rest = abs - whole;
  if (rest < 0.001) return `${sign}${whole}`;

  const glyph = fractionGlyph(rest);
  if (glyph) return whole > 0 ? `${sign}${whole} ${glyph}` : `${sign}${glyph}`;

  const fraction = new Fraction(rest).simplify(0.01);
  if (Number(fraction.d) < 64 && Number(fraction.d) !== 1) {
    return whole > 0 ? `${sign}${whole} ${fraction.n}/${fraction.d}` : `${sign}${fraction.n}/${fraction.d}`;
  }
  const text = abs.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  return `${sign}${text}`;
}

export function formatIngredient(
  amount: number | null,
  unit: string | null,
  name: string,
): string {
  if (amount === null || amount <= 0) return name;
  const shown = presentAmount(amount, unit);
  const label = unitLabel(shown.unit, shown.amount);
  return [formatAmount(shown.amount), label, name].filter(Boolean).join(" ");
}

/** Merge two amounts that share a unit. Other units stay separate. */
export function mergeAmount(
  a: { amount: number | null; unit: string | null },
  b: { amount: number | null; unit: string | null },
): { amount: number | null; unit: string | null } {
  if (a.unit !== b.unit) return a;
  if (a.amount === null || b.amount === null) return { amount: null, unit: a.unit };
  if (unitOf(a.unit)?.dimension === "time") return a;
  return { amount: roundToStep(a.amount + b.amount, unitOf(a.unit)?.roundStep ?? 0.25), unit: a.unit };
}

export const TEASPOON_GROUP = "teaspoon";
export const TABLESPOON_GROUP = "tablespoon";
