import type { DiffEntry, RecipeDiff } from "@kochen/contracts";
import { formatIngredient } from "@kochen/core";
import { cn } from "../../lib/utils";
import { durationLabel } from "./format";

const KIND_LABEL: Record<DiffEntry["kind"], string> = {
  same: "gleich",
  changed: "geändert",
  added: "neu",
  removed: "entfernt",
  moved: "verschoben",
};

const KIND_TONE: Record<DiffEntry["kind"], string> = {
  same: "",
  changed: "bg-gold/[0.08]",
  added: "bg-sage-soft/60",
  removed: "bg-danger/[0.07]",
  moved: "bg-ink/[0.04]",
};

const FIELD_LABEL: Record<string, string> = {
  amount: "Menge",
  unit: "Einheit",
  name: "Name",
  note: "Notiz",
  text: "Text",
  durationS: "Dauer",
};

type LineType = "ingredients" | "steps";

function lineText(line: Record<string, unknown> | null, type: LineType): string {
  if (!line) return "—";
  if (type === "ingredients") {
    const amount = typeof line.amount === "number" ? line.amount : null;
    const unit = typeof line.unit === "string" ? line.unit : null;
    const name = typeof line.name === "string" ? line.name : "";
    const note = typeof line.note === "string" && line.note ? ` (${line.note})` : "";
    return `${formatIngredient(amount, unit, name)}${note}`;
  }
  const text = typeof line.text === "string" ? line.text : "";
  const duration =
    typeof line.durationS === "number" ? durationLabel(line.durationS) : "";
  return duration ? `${text} · ${duration}` : text;
}

function DiffList({
  entries,
  type,
  emptyText,
}: {
  entries: DiffEntry[];
  type: LineType;
  emptyText: string;
}) {
  const relevant = entries.filter((entry) => entry.kind !== "same");
  const shown = relevant.length > 0 ? relevant : entries;
  if (shown.length === 0) {
    return <p className="px-1 text-sm text-ink-soft">{emptyText}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {shown.map((entry, index) => {
        const key = `${entry.lineageKey}-${index}`;
        if (entry.kind === "same") {
          return (
            <li key={key} className="flex items-start gap-2 rounded-lg px-3 py-2">
              <span className="mt-0.5 text-[11px] text-ink-soft">{KIND_LABEL.same}</span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-ink-soft">
                {lineText(entry.b ?? entry.a, type)}
              </p>
            </li>
          );
        }
        return (
          <li key={key} className={cn("rounded-lg px-3 py-2", KIND_TONE[entry.kind])}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                {KIND_LABEL[entry.kind]}
              </span>
              {entry.kind === "changed" && entry.fields.length > 0 && (
                <span className="text-[11px] text-ink-soft">
                  {entry.fields.map((field) => FIELD_LABEL[field] ?? field).join(", ")}
                </span>
              )}
            </div>
            <div className="mt-1 grid gap-1 sm:grid-cols-2 sm:gap-3">
              <p
                className={cn(
                  "whitespace-pre-wrap text-sm sm:border-r sm:border-line/70 sm:pr-3",
                  entry.kind === "removed" && "text-danger line-through",
                  entry.kind !== "removed" && "text-ink-soft",
                )}
              >
                <span className="mr-1.5 text-[11px] uppercase tracking-wide text-ink-soft sm:hidden">
                  Original
                </span>
                {lineText(entry.a, type)}
              </p>
              {entry.kind !== "removed" && (
                <p className="whitespace-pre-wrap text-sm text-ink">
                  <span className="mr-1.5 text-[11px] uppercase tracking-wide text-ink-soft sm:hidden">
                    Variante
                  </span>
                  {lineText(entry.b, type)}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function DiffView({ diff }: { diff: RecipeDiff }) {
  const changedIngredients = diff.ingredients.filter((entry) => entry.kind !== "same").length;
  const changedSteps = diff.steps.filter((entry) => entry.kind !== "same").length;

  return (
    <div className="space-y-5">
      {diff.predecessorChanged && (
        <div className="rounded-xl border border-gold/40 bg-gold/[0.08] px-4 py-3 text-sm text-ink">
          Das Original wurde nach dem Variieren geändert. Der Vergleich zeigt den
          Stand beim Variieren gegen das heutige Original.
        </div>
      )}

      <section>
        <h3 className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-base">
          Zutaten
          <span className="text-xs font-normal text-ink-soft">
            {changedIngredients === 0
              ? "keine Unterschiede"
              : `${changedIngredients} Unterschied${changedIngredients === 1 ? "" : "e"}`}
          </span>
        </h3>
        <DiffList
          entries={diff.ingredients}
          type="ingredients"
          emptyText="Dieses Rezept hat keine Zutaten."
        />
      </section>

      <section>
        <h3 className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-base">
          Schritte
          <span className="text-xs font-normal text-ink-soft">
            {changedSteps === 0
              ? "keine Unterschiede"
              : `${changedSteps} Unterschied${changedSteps === 1 ? "" : "e"}`}
          </span>
        </h3>
        <DiffList entries={diff.steps} type="steps" emptyText="Dieses Rezept hat keine Schritte." />
      </section>
    </div>
  );
}
