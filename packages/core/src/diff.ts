import type { DiffEntry } from "@kochen/contracts";

type Line = Record<string, unknown> & { lineageKey: string };

export type DiffOptions = {
  /** Fields that count as a change. */
  fields: string[];
};

/**
 * Diff two recipe line lists by lineage key.
 * A line missing on one side is added or removed.
 * A position change with equal fields is a move, not a change.
 */
export function diffLines(a: Line[], b: Line[], options: DiffOptions): DiffEntry[] {
  const byKeyA = new Map(a.map((line, index) => [line.lineageKey, { line, index }]));
  const byKeyB = new Map(b.map((line, index) => [line.lineageKey, { line, index }]));
  const keys: string[] = [];
  for (const line of a) keys.push(line.lineageKey);
  for (const line of b) if (!byKeyA.has(line.lineageKey)) keys.push(line.lineageKey);

  const out: DiffEntry[] = [];
  for (const key of keys) {
    const left = byKeyA.get(key);
    const right = byKeyB.get(key);
    if (left && !right) {
      out.push({
        kind: "removed",
        lineageKey: key,
        positionA: left.index,
        positionB: null,
        a: sanitize(left.line, options.fields),
        b: null,
        fields: [],
      });
      continue;
    }
    if (!left && right) {
      out.push({
        kind: "added",
        lineageKey: key,
        positionA: null,
        positionB: right.index,
        a: null,
        b: sanitize(right.line, options.fields),
        fields: [],
      });
      continue;
    }
    if (!left || !right) continue;
    const changed = options.fields.filter((field) => !sameValue(left.line[field], right.line[field]));
    const moved = left.index !== right.index;
    const kind: DiffEntry["kind"] =
      changed.length > 0 ? "changed" : moved ? "moved" : "same";
    out.push({
      kind,
      lineageKey: key,
      positionA: left.index,
      positionB: right.index,
      a: sanitize(left.line, options.fields),
      b: sanitize(right.line, options.fields),
      fields: changed,
    });
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.0001;
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return false;
}

function sanitize(line: Line, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = line[field] ?? null;
  return out;
}

/** Ingredients use amount, unit, name, note. Steps use text and duration. */
export const INGREDIENT_DIFF_FIELDS = ["amount", "unit", "name", "note"];
export const STEP_DIFF_FIELDS = ["text", "durationS"];
