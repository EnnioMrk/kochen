import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown, Star, X } from "lucide-react";
import { cn } from "../lib/utils";

/* ---------------------------------------------------------------- button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "sage";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

const VARIANTS: Record<string, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark shadow-sm disabled:bg-brand/50",
  secondary: "bg-white text-ink border border-line hover:border-ink/30 shadow-sm",
  ghost: "bg-transparent text-ink-soft hover:bg-ink/5 hover:text-ink",
  danger: "bg-danger text-white hover:bg-danger/90",
  sage: "bg-sage text-white hover:bg-sage/90",
};

const SIZES: Record<string, string> = {
  sm: "tap-target min-h-9 px-3 text-sm rounded-lg gap-1.5",
  md: "min-h-11 px-4 text-[0.95rem] rounded-xl gap-2",
  lg: "min-h-12 px-5 text-base rounded-xl gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "tap inline-flex items-center justify-center font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cn(
        "tap tap-target inline-flex size-10 items-center justify-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink active:scale-95",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ card */

export function Card({ className, children, as: As = "div" }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" }) {
  return (
    <As className={cn("rounded-[var(--radius-card)] border border-line bg-white/80 backdrop-blur-sm", className)}>
      {children}
    </As>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "sage" | "gold" | "danger";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink/5 text-ink-soft",
    brand: "bg-brand/10 text-brand-dark",
    sage: "bg-sage-soft text-sage-text",
    gold: "bg-gold/10 text-gold-text",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

const control =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-ink placeholder:text-ink-soft/85 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:opacity-60";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(control, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(control, "min-h-24 resize-y", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...rest} className={cn(control, "appearance-none pr-10", className)}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
      />
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "tap relative h-7 w-12 shrink-0 rounded-full transition outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          checked ? "bg-sage" : "bg-ink/15",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- misc */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Lädt"
      className={cn("inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-white/50 px-6 py-14 text-center">
      {icon && <div className="text-ink-soft/70">{icon}</div>}
      <h3 className="text-lg">{title}</h3>
      {body && <p className="max-w-sm text-sm leading-relaxed text-ink-soft">{body}</p>}
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  titleAddon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** A status badge or count that belongs to the title itself. */
  titleAddon?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-3xl leading-tight text-balance sm:text-4xl">{title}</h1>
          {titleAddon}
        </div>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-soft">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>a]:flex-1 max-sm:[&>button]:flex-1">
          {actions}
        </div>
      )}
    </header>
  );
}

export function Stars({
  value,
  onChange,
  size = 22,
  readOnly,
}: {
  value: number | null;
  onChange?: (stars: number) => void;
  size?: number;
  readOnly?: boolean;
}) {
  const rating = value ?? 0;
  const interactive = !readOnly && Boolean(onChange);
  const label = rating ? `${String(rating).replace(".", ",")} von 5 Sternen` : "Noch keine Bewertung";

  const set = (next: number) => {
    const clamped = Math.min(5, Math.max(0.5, Math.round(next * 2) / 2));
    onChange?.(clamped);
  };

  return (
    <div
      role={interactive ? "slider" : "img"}
      aria-label={interactive ? "Bewertung" : label}
      {...(interactive
        ? {
            tabIndex: 0,
            "aria-valuemin": 0.5,
            "aria-valuemax": 5,
            "aria-valuenow": rating || 0.5,
            "aria-valuetext": label,
          }
        : {})}
      onClick={
        interactive
          ? (event) => {
              const box = event.currentTarget.getBoundingClientRect();
              set(((event.clientX - box.left) / box.width) * 5);
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (event) => {
              const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 0.5 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -0.5 : null;
              if (step !== null) {
                event.preventDefault();
                set(rating + step);
              } else if (event.key === "Home") {
                event.preventDefault();
                set(0.5);
              } else if (event.key === "End") {
                event.preventDefault();
                set(5);
              }
            }
          : undefined
      }
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg",
        interactive &&
          "tap cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
      )}
      style={interactive ? { minHeight: 44, paddingBlock: `${Math.max(0, (44 - size) / 2)}px` } : undefined}
    >
      {[1, 2, 3, 4, 5].map((index) => {
        const fill = Math.max(0, Math.min(1, rating - (index - 1)));
        return (
          <span key={index} className="relative inline-block" style={{ width: size, height: size }} aria-hidden>
            <Star className="absolute inset-0 text-line" style={{ width: size, height: size }} strokeWidth={1.6} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="text-gold" style={{ width: size, height: size, fill: "currentColor" }} strokeWidth={1.2} />
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fluid,
}: {
  value: T;
  options: Array<{ value: T; label: string; shortLabel?: string }>;
  onChange: (next: T) => void;
  ariaLabel: string;
  /** Fill the available width with equal tabs instead of sizing to content. */
  fluid?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-paper-2/70 p-1",
        fluid && "flex w-full",
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "tap tap-target shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition md:px-3",
            fluid && "flex-1",
            value === option.value ? "bg-white text-ink shadow-sm" : "text-ink-soft hover:text-ink",
          )}
        >
          {option.shortLabel ? (
            <>
              <span className="md:hidden">{option.shortLabel}</span>
              <span className="hidden md:inline">{option.label}</span>
            </>
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return url && !failed ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full border border-line object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-sage-soft font-semibold text-sage-text"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

/**
 * An image that never leaves a broken frame behind. A missing source or a
 * failed load draws the fallback in place, so alt text never becomes layout.
 */
export function MediaImage({
  src,
  alt = "",
  className,
  fallback,
  loading,
  sizes,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  fallback: ReactNode;
  loading?: "lazy" | "eager";
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      sizes={sizes}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((node) => node.offsetParent !== null || node === panel);

    // Open focus on the first control, so the dialog is never behind the trigger.
    (focusables()[0] ?? panel)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = list[0] as HTMLElement;
      const last = list[list.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border border-line bg-paper p-5 pb-[calc(1.25rem+var(--safe-bottom))] shadow-2xl sm:max-h-[85dvh] sm:rounded-2xl sm:pb-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl">{title}</h2>
          <IconButton label="Schließen" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

type Toast = { id: number; text: string; tone: "info" | "error" | "success" };
const ToastContext = createContext<{ push: (text: string, tone?: Toast["tone"]) => void }>({
  push: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((item) => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+var(--safe-bottom))] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm shadow-lg",
              item.tone === "error" ? "bg-danger text-white" : item.tone === "success" ? "bg-sage text-white" : "bg-ink text-white",
            )}
          >
            {item.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-ink/5", className)} />;
}
