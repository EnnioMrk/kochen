import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  colorsOf,
  contrastRatio,
  harmonyOf,
  isHex,
  resolveTheme,
  sanitizeChoice,
  type ThemeColors,
} from "./theme";

const hexTokens = [
  "paper",
  "paper2",
  "surface",
  "ink",
  "inkSoft",
  "line",
  "brand",
  "brandDark",
  "brandSoft",
  "onBrand",
  "sage",
  "sageSoft",
  "sageText",
  "onSage",
  "gold",
  "goldText",
  "danger",
  "onDanger",
  "onInk",
] as const;

const custom: ThemeColors = {
  paper: "#f5eee7",
  ink: "#241a20",
  brand: "#7a3f5c",
  sage: "#4f6b52",
};

describe("theme resolver", () => {
  it("returns a full hex palette for every preset", () => {
    for (const preset of THEME_PRESETS) {
      const { tokens } = resolveTheme({ preset: preset.id });
      for (const name of hexTokens) {
        expect(isHex(tokens[name]), `${preset.id}.${name} = ${tokens[name]}`).toBe(true);
      }
    }
  });

  it("keeps text readable on every preset", () => {
    for (const preset of THEME_PRESETS) {
      const theme = resolveTheme({ preset: preset.id });
      const paper = colorsOf({ preset: preset.id }).paper;
      expect(contrastRatio(theme.tokens.ink, paper), `${preset.id} ink`).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.tokens.inkSoft, paper), `${preset.id} inkSoft`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.tokens.sageText, paper),
        `${preset.id} sage text`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.tokens.onBrand, theme.tokens.brand),
        `${preset.id} on brand`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(theme.tokens.onSage, theme.tokens.sage),
        `${preset.id} on secondary`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("infers dark mode from the paper", () => {
    expect(resolveTheme({ preset: "espresso" }).mode).toBe("dark");
    expect(resolveTheme({ preset: "paprika" }).mode).toBe("light");
    expect(resolveTheme({ preset: "custom", colors: { ...custom, paper: "#12100d" } }).mode).toBe("dark");
  });

  it("derives a complete custom palette from four colours", () => {
    const theme = resolveTheme({ preset: "custom", colors: custom, name: "Pflaume" });
    expect(theme.id).toBe("custom");
    expect(theme.name).toBe("Pflaume");
    expect(theme.tokens.brand).toBe(custom.brand);
    expect(theme.tokens.sage).toBe(custom.sage);
    expect(theme.tokens.paper).toBe(custom.paper);
  });

  it("falls back to Paprika colours for an unnamed custom theme", () => {
    const theme = resolveTheme({ preset: "custom" });
    expect(theme.mode).toBe("light");
    expect(theme.tokens.paper).toBe("#faf7f2");
  });
});

describe("stored theme", () => {
  it("accepts a shipped preset", () => {
    expect(sanitizeChoice({ preset: "safran" })).toEqual({ preset: "safran" });
    expect(sanitizeChoice(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
  });

  it("accepts a valid custom palette", () => {
    const value = sanitizeChoice({ preset: "custom", colors: custom, name: "Pflaume" });
    expect(value?.preset).toBe("custom");
    expect(value?.colors).toEqual(custom);
  });

  it("rejects unknown presets and broken colours", () => {
    expect(sanitizeChoice({ preset: "neon" })).toBeNull();
    expect(sanitizeChoice({ preset: "custom", colors: { ...custom, brand: "red" } })).toBeNull();
    expect(sanitizeChoice(null)).toBeNull();
    expect(sanitizeChoice("paprika")).toBeNull();
  });
});

describe("harmony", () => {
  it("flags the old terracotta and olive pair as equal weight", () => {
    const old = harmonyOf("#b4552d", "#63714f");
    expect(old.competing).toBe(true);
    expect(old.relation).toBe("Analog");
  });

  it("accepts the shipped Paprika pair", () => {
    const now = harmonyOf("#b4552d", "#3f5d63");
    expect(now.competing).toBe(false);
    expect(now.relation).toBe("Komplementär");
    expect(now.hueGap).toBeGreaterThan(150);
  });

  it("accepts every shipped preset", () => {
    for (const preset of THEME_PRESETS) {
      expect(harmonyOf(preset.colors.brand, preset.colors.sage).competing, preset.id).toBe(false);
    }
  });
});
