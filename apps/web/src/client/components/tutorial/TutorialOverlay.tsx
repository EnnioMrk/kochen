import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui";
import { TOUR_STEPS } from "./tour-steps";

/**
 * Spotlight tour. One circle shows the part that the text explains. The circle
 * starts wide and shrinks onto the target while the page behind it blurs and
 * darkens a little, so the eye follows the zoom.
 */

type Spot = { cx: number; cy: number; r: number };

const HOLE_PADDING = 8;
/** Darkening around the circle at the end of the zoom. Kept low on purpose. */
const SPOT_ALPHA = 0.3;
/** Darkening for a step without a circle. */
const PLAIN_ALPHA = 0.55;
/** Width of the soft edge around the circle, in pixels. */
const FEATHER = 56;
const ZOOM_MS = 560;
const FADE_MS = 420;
const CARD_MAX_WIDTH = 380;

function visibleTarget(name: string): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = window.getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    return node;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/** A radial gradient that hides the middle and fades in towards the edge. */
function maskFor(cx: number, cy: number, radius: number): string {
  const outer = radius + FEATHER;
  const inner = Math.max(0, radius - FEATHER * 0.35);
  return `radial-gradient(circle ${outer}px at ${cx}px ${cy}px, transparent ${inner}px, #000 ${outer}px)`;
}

function setMask(element: HTMLElement, value: string | null): void {
  const style = element.style as CSSStyleDeclaration & { webkitMaskImage: string };
  if (value === null) {
    style.maskImage = "none";
    style.webkitMaskImage = "none";
    return;
  }
  style.maskImage = value;
  style.webkitMaskImage = value;
}

export function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === "undefined" ? 0 : window.innerWidth,
    h: typeof window === "undefined" ? 0 : window.innerHeight,
  }));

  const shadeRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);

  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  const next = useCallback(() => {
    setIndex((current) => {
      if (current >= TOUR_STEPS.length - 1) {
        onClose();
        return current;
      }
      return current + 1;
    });
  }, [onClose]);

  const back = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  /* Keep the page still, so the spotlight and its target stay together. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, next, onClose]);

  /* Measure the target and run the zoom. */
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    setSpot(null);

    const current = TOUR_STEPS[index];
    const shade = shadeRef.current;
    if (!current || !shade) return;
    let cancelled = false;

    const fade = (to: number, duration: number) => {
      const started = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - started) / duration);
        shade.style.opacity = String(to * t);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const rest = () => {
      setMask(shade, null);
      fade(PLAIN_ALPHA, FADE_MS);
    };

    const zoom = (cx: number, cy: number, from: number, to: number) => {
      const started = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - started) / ZOOM_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        setMask(shade, maskFor(cx, cy, from + (to - from) * eased));
        // Nothing at the start, a little at the end.
        shade.style.opacity = String(SPOT_ALPHA * eased);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const measure = (attempt: number) => {
      if (cancelled) return;
      if (!current.target) {
        rest();
        return;
      }
      const node = visibleTarget(current.target);
      if (!node) {
        if (attempt < 10) {
          rafRef.current = requestAnimationFrame(() => measure(attempt + 1));
        } else {
          rest();
        }
        return;
      }
      const box = node.getBoundingClientRect();
      const partlyHidden = box.top < 12 || box.bottom > window.innerHeight - 12;
      if (partlyHidden && attempt < 4) {
        node.scrollIntoView({ block: "center" });
        rafRef.current = requestAnimationFrame(() => measure(attempt + 1));
        return;
      }
      const measured = node.getBoundingClientRect();
      const cx = measured.left + measured.width / 2;
      const cy = measured.top + measured.height / 2;
      const targetRadius = Math.max(30, Math.hypot(measured.width, measured.height) / 2 + HOLE_PADDING);
      const startRadius = Math.max(window.innerWidth, window.innerHeight) * 0.62;
      setSpot({ cx, cy, r: targetRadius });
      rafRef.current = requestAnimationFrame(() =>
        zoom(cx, cy, Math.max(startRadius, targetRadius), targetRadius),
      );
    };

    measure(0);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [index, viewport.w, viewport.h]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [index]);

  const { w, h } = viewport;
  const cardWidth = Math.min(CARD_MAX_WIDTH, w - 32);

  let cardStyle: CSSProperties;
  if (spot) {
    const below = spot.cy + spot.r + 16 + 220 < h;
    cardStyle = {
      left: clamp(spot.cx - cardWidth / 2, 16, w - cardWidth - 16),
      top: below ? spot.cy + spot.r + 16 : spot.cy - spot.r - 16,
      width: cardWidth,
      transform: below ? undefined : "translateY(-100%)",
    };
  } else {
    cardStyle = {
      left: clamp(w / 2 - cardWidth / 2, 16, w - cardWidth - 16),
      top: h / 2,
      width: cardWidth,
      transform: "translateY(-50%)",
    };
  }

  const overlay = (
    <div className="fixed inset-0 z-[95]" role="presentation">
      <div
        ref={shadeRef}
        aria-hidden="true"
        className="pointer-events-auto absolute inset-0"
        style={{
          opacity: 0,
          background: "rgba(20, 16, 12, 1)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kochen-tour-title"
        aria-describedby="kochen-tour-body"
        tabIndex={-1}
        className="tap absolute max-h-[calc(100dvh-32px)] overflow-y-auto rounded-[var(--radius-card)] border border-line bg-paper p-5 shadow-2xl outline-none"
        style={cardStyle}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Tour · {index + 1} von {TOUR_STEPS.length}
        </p>
        <h2 id="kochen-tour-title" className="mt-1 text-xl leading-tight">
          {step?.title}
        </h2>
        <p id="kochen-tour-body" aria-live="polite" className="mt-2 text-sm leading-relaxed text-ink-soft">
          {step?.body}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {index > 0 ? (
            <Button variant="secondary" size="sm" onClick={back}>
              Zurück
            </Button>
          ) : null}
          <Button size="sm" onClick={next} className="ml-auto">
            {last ? "Fertig" : "Weiter"}
          </Button>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="tap-target inline-flex min-h-9 items-center text-xs font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            Überspringen
          </button>
          <div className="flex items-center gap-1" aria-hidden="true">
            {TOUR_STEPS.map((_, dot) => (
              <span
                key={dot}
                className={
                  dot === index
                    ? "size-1.5 rounded-full bg-brand"
                    : "size-1.5 rounded-full bg-line"
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
