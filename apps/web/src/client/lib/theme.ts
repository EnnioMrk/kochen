/**
 * Runtime colour system.
 *
 * Every colour the app paints comes from a CSS custom property
 * (`--color-*`). This module resolves one of the shipped palettes, or a
 * member's own four colours, into that property set. The resolver also
 * derives the shades a palette implies: recessed paper, hairlines, tinted
 * badges, hover shades and the ink that stays readable on each fill.
 *
 * A custom palette needs only four decisions: paper, ink, primary and
 * secondary. Everything else follows from them, so a member cannot create
 * an unreadable page by picking a single bad shade.
 */

export type ThemeMode = "light" | "dark";

export type ThemeColors = {
  /** Page background. Also decides light or dark mode. */
  paper: string;
  /** Body text. */
  ink: string;
  /** Primary actions, links, focus. */
  brand: string;
  /** Secondary accent: ratings context, cooked state, quiet badges. */
  sage: string;
};

export type ThemePresetId = "paprika" | "salbei" | "leinen" | "safran" | "espresso" | "custom";

export type ThemeChoice = {
  preset: ThemePresetId;
  /** Only for `custom`. Presets carry their own full palette. */
  colors?: ThemeColors;
  /** Optional member-given name for a custom palette. */
  name?: string;
};

export type ThemeTokens = Record<
  | "paper"
  | "paper2"
  | "surface"
  | "ink"
  | "inkSoft"
  | "line"
  | "brand"
  | "brandDark"
  | "brandSoft"
  | "onBrand"
  | "sage"
  | "sageSoft"
  | "sageText"
  | "onSage"
  | "gold"
  | "goldText"
  | "danger"
  | "onDanger"
  | "onInk",
  string
>;

export type ResolvedTheme = {
  id: ThemePresetId;
  name: string;
  mode: ThemeMode;
  tokens: ThemeTokens;
  /** Extra custom properties that are not colours. */
  extras: Record<string, string>;
};

export const THEME_STORAGE_KEY = "rezeptor.theme.v1";

type Preset = {
  id: Exclude<ThemePresetId, "custom">;
  name: string;
  tagline: string;
  colors: ThemeColors;
  gold: string;
  danger: string;
};

export const THEME_PRESETS: Preset[] = [
  {
    id: "paprika",
    name: "Paprika",
    tagline: "Terrakotta auf Papier. Die Küche, in der das Rezept entstand.",
    colors: { paper: "#faf7f2", ink: "#211c16", brand: "#b4552d", sage: "#3f5d63" },
    gold: "#c98a2b",
    danger: "#a83232",
  },
  {
    id: "salbei",
    name: "Salbeigarten",
    tagline: "Kräutergrün und Ton. Ruhig für lange Kochabende.",
    colors: { paper: "#f3f6ee", ink: "#1e2419", brand: "#4d6746", sage: "#b07a4c" },
    gold: "#b8862c",
    danger: "#a3352f",
  },
  {
    id: "leinen",
    name: "Leinen",
    tagline: "Kühles Grau und Petrol. Für helle Küchen.",
    colors: { paper: "#f1f4f4", ink: "#1a2126", brand: "#2f5d63", sage: "#b07a4c" },
    gold: "#b0812b",
    danger: "#a63535",
  },
  {
    id: "safran",
    name: "Safran",
    tagline: "Goldene Wärme, wie ein volles Gewürzregal.",
    colors: { paper: "#fbf5e9", ink: "#241d12", brand: "#9a6214", sage: "#3f5a72" },
    gold: "#bd8420",
    danger: "#a33232",
  },
  {
    id: "espresso",
    name: "Espresso",
    tagline: "Dunkles Papier für spätes Kochen und wenig Licht.",
    colors: { paper: "#17130f", ink: "#f3e9db", brand: "#e08a5b", sage: "#6f8f8b" },
    gold: "#e0b264",
    danger: "#e88a85",
  },
];

export const DEFAULT_THEME: ThemeChoice = { preset: "paprika" };

/** The four base colours behind any choice. */
export function colorsOf(choice: ThemeChoice): ThemeColors {
  if (choice.preset === "custom" && choice.colors) return choice.colors;
  const preset = THEME_PRESETS.find((item) => item.id === choice.preset) ?? THEME_PRESETS[0]!;
  return preset.colors;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** A stored theme is trusted only as far as it matches this shape. */
export function sanitizeChoice(input: unknown): ThemeChoice | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const preset = value.preset;
  const allowed = [...THEME_PRESETS.map((item) => item.id), "custom"];
  if (typeof preset !== "string" || !allowed.includes(preset as ThemePresetId)) return null;
  if (preset !== "custom") {
    return {
      preset: preset as ThemePresetId,
      ...(typeof value.name === "string" ? { name: value.name.slice(0, 40) } : {}),
    };
  }
  const colors = value.colors as Record<string, unknown> | undefined;
  if (
    !colors ||
    !isHex(colors.paper) ||
    !isHex(colors.ink) ||
    !isHex(colors.brand) ||
    !isHex(colors.sage)
  ) {
    return null;
  }
  return {
    preset: "custom",
    colors: {
      paper: colors.paper.toLowerCase(),
      ink: colors.ink.toLowerCase(),
      brand: colors.brand.toLowerCase(),
      sage: colors.sage.toLowerCase(),
    },
    ...(typeof value.name === "string" ? { name: value.name.trim().slice(0, 40) } : {}),
  };
}

/* ------------------------------------------------------------ colour math */

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** sRGB mix. Good for tints that must keep the hue of both parents. */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const t = Math.min(1, Math.max(0, amount));
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

type Lab = { l: number; a: number; b: number };

function toLab(hex: string): Lab {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l3 = Math.cbrt(l);
  const m3 = Math.cbrt(m);
  const s3 = Math.cbrt(s);
  return {
    l: 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3,
    a: 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3,
    b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3,
  };
}

function fromLab({ l, a, b }: Lab): string {
  const l3 = l + 0.3963377774 * a + 0.2158037573 * b;
  const m3 = l - 0.1055613458 * a - 0.0638541728 * b;
  const s3 = l - 0.0894841775 * a - 1.291485548 * b;
  const lc = l3 ** 3;
  const mc = m3 ** 3;
  const sc = s3 ** 3;
  const linear: Rgb = [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
  return toHex(
    linear.map((channel) => {
      const c = Math.min(1, Math.max(0, channel));
      const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
      return s * 255;
    }) as Rgb,
  );
}

/** Move a colour along OKLCH lightness while its hue stays put. */
export function shiftLightness(hex: string, delta: number): string {
  const lab = toLab(hex);
  const chroma = Math.hypot(lab.a, lab.b);
  const hue = Math.atan2(lab.b, lab.a);
  const l = Math.min(1, Math.max(0, lab.l + delta));
  return fromLab({ l, a: Math.cos(hue) * chroma, b: Math.sin(hue) * chroma });
}

/** Hue, lightness and chroma, for the harmony check. */
export function oklchOf(hex: string): { l: number; c: number; h: number } {
  const lab = toLab(hex);
  return {
    l: lab.l,
    c: Math.hypot(lab.a, lab.b),
    h: ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360,
  };
}

export type Harmony = {
  /** Shortest distance between the two hues, in degrees. */
  hueGap: number;
  lightnessGap: number;
  chromaGap: number;
  relation: "Verwandt" | "Analog" | "Gemischt" | "Komplementär";
  /** Both colours carry similar weight, so neither wins. */
  competing: boolean;
};

/**
 * How two accents sit next to each other. Research says a pair works when it
 * differs in hue by a clear step, or in value, or in chroma. Two mid-tone
 * colours at equal value vibrate and read as mud.
 */
export function harmonyOf(a: string, b: string): Harmony {
  const left = oklchOf(a);
  const right = oklchOf(b);
  const raw = Math.abs(left.h - right.h);
  const hueGap = Math.round(Math.min(raw, 360 - raw));
  const lightnessGap = Math.abs(left.l - right.l);
  const chromaGap = Math.abs(left.c - right.c);
  const relation =
    hueGap <= 40 ? "Verwandt" : hueGap <= 90 ? "Analog" : hueGap < 150 ? "Gemischt" : "Komplementär";
  // Two mid-tone accents at nearly the same value fight each other.
  const competing = hueGap > 30 && hueGap < 150 && contrastRatio(a, b) < 1.25;
  return { hueGap, lightnessGap, chromaGap, relation, competing };
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const LIGHT_INK = "#ffffff";
const DARK_INK = "#16110d";

/** The text colour with the best contrast on a fill. */
export function readableOn(fill: string): string {
  return contrastRatio(LIGHT_INK, fill) >= contrastRatio(DARK_INK, fill) ? LIGHT_INK : DARK_INK;
}

/** Push `text` toward black or white until it clears `target` on `background`. */
export function ensureContrast(text: string, background: string, target = 4.5): string {
  if (contrastRatio(text, background) >= target) return text;
  const direction = luminance(background) > 0.4 ? "#000000" : "#ffffff";
  let low = 0;
  let high = 1;
  let best = text;
  for (let index = 0; index < 24; index += 1) {
    const mid = (low + high) / 2;
    const candidate = mix(text, direction, mid);
    if (contrastRatio(candidate, background) >= target) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

/* --------------------------------------------------------------- resolver */

function baseOf(choice: ThemeChoice): { colors: ThemeColors; gold: string; danger: string; name: string } {
  if (choice.preset === "custom" && choice.colors) {
    const dark = luminance(choice.colors.paper) < 0.3;
    return {
      colors: choice.colors,
      gold: dark ? "#e0b264" : "#c98a2b",
      danger: dark ? "#e88a85" : "#a83232",
      name: choice.name?.trim() || "Eigene Palette",
    };
  }
  const preset = THEME_PRESETS.find((item) => item.id === choice.preset) ?? THEME_PRESETS[0]!;
  return { colors: preset.colors, gold: preset.gold, danger: preset.danger, name: preset.name };
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  const { colors, gold, danger, name } = baseOf(choice);
  const paper = colors.paper.toLowerCase();
  const ink = colors.ink.toLowerCase();
  const brand = colors.brand.toLowerCase();
  const sage = colors.sage.toLowerCase();
  const mode: ThemeMode = luminance(paper) < 0.3 ? "dark" : "light";
  const dark = mode === "dark";

  // Recessed in both modes: below the page in light, below the page in dark.
  const paper2 = shiftLightness(paper, dark ? -0.02 : -0.045);
  const surface = dark ? shiftLightness(paper, 0.028) : mix(paper, "#ffffff", 0.65);
  const inkSoft = mix(ink, paper, 0.3);
  const line = shiftLightness(paper, dark ? 0.13 : -0.085);
  const brandDark = dark ? shiftLightness(brand, 0.06) : shiftLightness(brand, -0.045);
  const brandSoft = mix(brand, paper, 0.9);
  const onBrand = readableOn(brand);
  const sageSoft = mix(sage, paper, dark ? 0.8 : 0.82);
  const sageText = ensureContrast(sage, paper, 4.6);
  const onSage = readableOn(sage);
  const goldText = ensureContrast(gold, paper, 4.6);
  const onDanger = readableOn(danger);
  const onInk = readableOn(ink);

  return {
    id: choice.preset,
    name,
    mode,
    tokens: {
      paper,
      paper2,
      surface,
      ink,
      inkSoft,
      line,
      brand,
      brandDark,
      brandSoft,
      onBrand,
      sage,
      sageSoft,
      sageText,
      onSage,
      gold,
      goldText,
      danger,
      onDanger,
      onInk,
    },
    extras: {
      "--theme-shadow": `color-mix(in oklab, ${ink} 24%, transparent)`,
      "--theme-grain-a": `color-mix(in oklab, ${brand} 6%, transparent)`,
      "--theme-grain-b": `color-mix(in oklab, ${sage} 7%, transparent)`,
      "--theme-selection": `color-mix(in oklab, ${brand} 22%, transparent)`,
    },
  };
}

/* ------------------------------------------------------------- apply/store */

type StoredTheme = {
  choice: ThemeChoice;
  vars: Record<string, string>;
  mode: ThemeMode;
  id: ThemePresetId;
};

function tokensToVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    // paper2 -> paper-2, inkSoft -> ink-soft
    const kebab = key.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
    vars[`--color-${kebab}`] = value;
  }
  return vars;
}

export function applyTheme(choice: ThemeChoice, persist = true): ResolvedTheme {
  const resolved = resolveTheme(choice);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  const vars = { ...tokensToVars(resolved.tokens), ...resolved.extras };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.theme = resolved.id;
  root.style.colorScheme = resolved.mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", resolved.tokens.paper);
  if (persist) storeTheme(choice, resolved, vars);
  return resolved;
}

function storeTheme(choice: ThemeChoice, resolved: ResolvedTheme, vars: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stored: StoredTheme = {
      choice,
      vars,
      mode: resolved.mode,
      id: resolved.id,
    };
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A full or blocked storage must never stop the paint.
  }
}

export function readStoredChoice(): ThemeChoice | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { choice?: unknown };
    return sanitizeChoice(stored.choice);
  } catch {
    return null;
  }
}

export function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function sameChoice(a: ThemeChoice | null | undefined, b: ThemeChoice | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
