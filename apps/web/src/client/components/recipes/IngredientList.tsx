import type { Ingredient } from "@kochen/contracts";
import {
  formatAmount,
  presentAmount,
  scaleAmount,
  unitLabel,
} from "@kochen/core";
import { Check, Minus, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { IconButton } from "../ui";

export function ServingsStepper({
  value,
  onChange,
  base,
  compact,
}: {
  value: number;
  onChange: (next: number) => void;
  base?: number;
  compact?: boolean;
}) {
  const clamp = (next: number) => Math.max(1, Math.min(100, Math.round(next)));
  return (
    <div className="flex items-center gap-2">
      <IconButton
        label="Eine Portion weniger"
        disabled={value <= 1}
        onClick={() => onChange(clamp(value - 1))}
        className={cn(
          "min-h-11 min-w-11 border border-line bg-white disabled:opacity-40",
          compact ? "size-11" : "size-11",
        )}
      >
        <Minus className="size-4" />
      </IconButton>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={100}
        value={value}
        aria-label="Portionen"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
        className={cn(
          "rounded-xl border border-line bg-white text-center tabular-nums outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15",
          compact ? "w-14 py-2 text-base" : "w-16 py-2.5 text-lg",
        )}
      />
      <IconButton
        label="Eine Portion mehr"
        disabled={value >= 100}
        onClick={() => onChange(clamp(value + 1))}
        className="min-h-11 min-w-11 border border-line bg-white disabled:opacity-40"
      >
        <Plus className="size-4" />
      </IconButton>
      {base !== undefined && base !== value && (
        <span className="text-xs text-ink-soft">statt {base}</span>
      )}
    </div>
  );
}

/** One ingredient row. Amounts are scaled for display only. */
function IngredientRowBody({
  item,
  factor,
}: {
  item: Ingredient;
  factor: number;
}) {
  const scaled = item.amount === null ? null : scaleAmount(item.amount, item.unit, factor);
  const shown = scaled === null ? null : presentAmount(scaled, item.unit);
  const amountText = shown
    ? [formatAmount(shown.amount), item.unitLabel ?? unitLabel(shown.unit, shown.amount)]
        .filter(Boolean)
        .join(" ")
    : "";
  return (
    <>
      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-ink sm:w-24">
        {amountText}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed">
        <span className="text-ink">{item.name}</span>
        {item.note && <span className="ml-1 text-ink-soft">({item.note})</span>}
      </span>
    </>
  );
}

export function IngredientRows({
  ingredients,
  factor = 1,
  checked,
  onToggle,
  emptyText,
  className,
}: {
  ingredients: Ingredient[];
  factor?: number;
  checked?: string[];
  onToggle?: (key: string) => void;
  emptyText?: string;
  className?: string;
}) {
  if (ingredients.length === 0) {
    return <p className="text-sm text-ink-soft">{emptyText ?? "Keine Zutaten eingetragen."}</p>;
  }
  return (
    <ul className={cn("divide-y divide-line/60", className)}>
      {ingredients.map((item, index) => {
        const key = item.id ?? item.lineageKey ?? `ingredient-${index}`;
        const isChecked = checked?.includes(key) ?? false;
        if (onToggle) {
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onToggle(key)}
                aria-pressed={isChecked}
                className={cn(
                  "tap flex min-h-11 w-full items-start gap-3 px-1 py-2.5 text-left transition",
                  isChecked ? "opacity-45" : "hover:bg-ink/[0.02]",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition",
                    isChecked ? "border-sage bg-sage text-white" : "border-line bg-white",
                  )}
                >
                  {isChecked && <Check className="size-3.5" />}
                </span>
                <IngredientRowBody item={item} factor={factor} />
              </button>
            </li>
          );
        }
        return (
          <li key={key} className="flex items-start gap-3 px-1 py-2.5">
            <IngredientRowBody item={item} factor={factor} />
          </li>
        );
      })}
    </ul>
  );
}
