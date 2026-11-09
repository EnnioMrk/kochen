import { Minus, Plus } from "lucide-react";
import { cn } from "../../lib/utils";

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 100,
  label,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label: string;
  className?: string;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-xl border border-line bg-white p-1", className)}>
      <button
        type="button"
        aria-label={`${label} verringern`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="tap inline-flex size-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <span className="min-w-9 text-center text-sm font-medium tabular-nums text-ink">{value}</span>
      <button
        type="button"
        aria-label={`${label} erhöhen`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="tap inline-flex size-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-ink/5 hover:text-ink disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
