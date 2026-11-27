import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Palette, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  colorsOf,
  contrastRatio,
  harmonyOf,
  isHex,
  resolveTheme,
  type ThemeChoice,
  type ThemeColors,
  type ThemePresetId,
} from "../../lib/theme";
import { useTheme } from "../ThemeProvider";
import { Badge, Button, Field, Input } from "../ui";

function ratioLabel(ratio: number): string {
  const value = ratio.toFixed(1).replace(".", ",");
  if (ratio >= 4.5) return `${value}:1 · AA`;
  if (ratio >= 3) return `${value}:1 · groß`;
  return `${value}:1 · zu schwach`;
}

function toneFor(ratio: number): "sage" | "gold" | "danger" {
  if (ratio >= 4.5) return "sage";
  if (ratio >= 3) return "gold";
  return "danger";
}

function ContrastRow({ label, ratio }: { label: string; ratio: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-ink-soft">{label}</span>
      <Badge tone={toneFor(ratio)}>{ratioLabel(ratio)}</Badge>
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [text, setText] = useState(value.toUpperCase());
  useEffect(() => setText(value.toUpperCase()), [value]);

  const commit = (raw: string) => {
    const next = raw.startsWith("#") ? raw : `#${raw}`;
    if (isHex(next)) onChange(next.toLowerCase());
    else setText(value.toUpperCase());
  };

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <span className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} wählen`}
          className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
        />
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value.toUpperCase());
            commit(event.target.value.trim());
          }}
          onBlur={() => setText(value.toUpperCase())}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          className="w-full bg-transparent font-mono text-xs uppercase text-ink outline-none"
          aria-label={`${label} als Hex-Wert`}
        />
      </span>
      <span className="mt-1 block text-[11px] leading-snug text-ink-soft">{hint}</span>
    </label>
  );
}

export function ThemePicker() {
  const { choice, active, presets, save, preview, restore } = useTheme();
  const [editorOpen, setEditorOpen] = useState(choice.preset === "custom");
  const [name, setName] = useState(choice.name ?? "");
  const [draft, setDraft] = useState<ThemeColors>(() => colorsOf(choice.preset === "custom" ? choice : active));
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  // A saved custom palette opens its editor, even when the account answer
  // arrives after the first render.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || choice.preset !== "custom") return;
    autoOpened.current = true;
    setEditorOpen(true);
    setDraft(colorsOf(choice));
    setName(choice.name ?? "");
  }, [choice]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) restoreRef.current();
    };
  }, []);

  const customTheme: ThemeChoice = useMemo(
    () => ({ preset: "custom", colors: draft, name: name.trim() || "Eigene Palette" }),
    [draft, name],
  );
  const customResolved = useMemo(() => resolveTheme(customTheme), [customTheme]);
  const tokens = customResolved.tokens;
  const harmony = harmonyOf(draft.brand, draft.sage);

  const update = (patch: Partial<ThemeColors>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setDirty(true);
    dirtyRef.current = true;
    preview({ preset: "custom", colors: next, name: name.trim() || "Eigene Palette" });
  };

  const openEditor = () => {
    const start = colorsOf(choice.preset === "custom" ? choice : active);
    const nextName = choice.preset === "custom" ? (choice.name ?? "") : "";
    setDraft(start);
    setName(nextName);
    setEditorOpen(true);
    // A preset turned custom is a new, unsaved palette.
    const unsaved = choice.preset !== "custom";
    setDirty(unsaved);
    dirtyRef.current = unsaved;
    preview({ preset: "custom", colors: start, name: nextName || undefined });
  };

  const discard = () => {
    setDirty(false);
    dirtyRef.current = false;
    setEditorOpen(choice.preset === "custom");
    setDraft(colorsOf(choice.preset === "custom" ? choice : active));
    setName(choice.preset === "custom" ? (choice.name ?? "") : "");
    restore();
  };

  const commitCustom = async () => {
    setDirty(false);
    dirtyRef.current = false;
    await save(customTheme);
  };

  const pickPreset = (id: ThemePresetId) => {
    setDirty(false);
    dirtyRef.current = false;
    setEditorOpen(false);
    void save({ preset: id });
  };

  return (
    <section aria-labelledby="theme-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="theme-heading" className="flex items-center gap-2 text-lg">
            <Palette className="size-5 text-sage" />
            Darstellung
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">
            Papier, Tinte und zwei Farben. Alles andere leitet die App daraus ab — hell oder dunkel.
          </p>
        </div>
        {choice.preset !== "paprika" && (
          <Button variant="ghost" size="sm" onClick={() => pickPreset("paprika")}>
            <RotateCcw className="size-4" />
            Standard
          </Button>
        )}
      </div>

      <div role="radiogroup" aria-label="Farbschema" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {presets.map((preset) => {
          const previewTheme = resolveTheme({ preset: preset.id });
          const selected = choice.preset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pickPreset(preset.id)}
              className={cn(
                "tap group rounded-xl border p-2 text-left transition",
                selected
                  ? "border-brand bg-surface ring-2 ring-brand/15"
                  : "border-line bg-surface/60 hover:border-ink/25",
              )}
            >
              <span
                aria-hidden
                className="relative block h-16 overflow-hidden rounded-lg"
                style={{ background: previewTheme.tokens.paper }}
              >
                <span
                  className="absolute inset-x-2.5 top-2.5 h-7 rounded-md"
                  style={{ background: previewTheme.tokens.surface, border: `1px solid ${previewTheme.tokens.line}` }}
                />
                <span
                  className="absolute left-4 top-3.5 h-1.5 w-8 rounded-full"
                  style={{ background: previewTheme.tokens.brand }}
                />
                <span
                  className="absolute left-4 top-6 h-1.5 w-5 rounded-full"
                  style={{ background: previewTheme.tokens.sage }}
                />
              </span>
              <span className="mt-2 flex items-center justify-between gap-1">
                <span className="truncate text-sm font-medium text-ink">{preset.name}</span>
                {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">
                {previewTheme.mode === "dark" ? "Dunkel" : "Hell"}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => (editorOpen ? discard() : openEditor())}
          aria-expanded={editorOpen}
          className={cn(
            "tap rounded-xl border border-dashed p-2 text-left transition",
            editorOpen ? "border-brand bg-surface ring-2 ring-brand/15" : "border-line bg-surface/60 hover:border-ink/25",
          )}
        >
          <span aria-hidden className="flex h-16 items-center justify-center gap-1.5 rounded-lg bg-paper-2">
            {(["paper", "brand", "sage", "ink"] as const).map((key) => (
              <span
                key={key}
                className="size-5 rounded-full border border-line"
                style={{ background: colorsOf(active)[key] }}
              />
            ))}
          </span>
          <span className="mt-2 flex items-center justify-between gap-1">
            <span className="truncate text-sm font-medium text-ink">
              {choice.preset === "custom" ? (choice.name ?? "Eigene Palette") : "Eigene"}
            </span>
            {choice.preset === "custom" && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-soft">Vier Farben, dein Kochbuch.</span>
        </button>
      </div>

      <p className="text-xs leading-relaxed text-ink-soft">
        {presets.find((preset) => preset.id === choice.preset)?.tagline ??
          "Deine eigene Palette. Sie gilt auf jedem Gerät, sobald du angemeldet bist."}
      </p>

      {editorOpen && (
        <div className="space-y-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base">Eigene Palette</h3>
            <Badge tone={customResolved.mode === "dark" ? "neutral" : "gold"}>
              {customResolved.mode === "dark" ? "Dunkel erkannt" : "Hell erkannt"}
            </Badge>
          </div>

          <div
            aria-hidden
            className="rounded-xl border p-3"
            style={{ background: tokens.paper, borderColor: tokens.line }}
          >
            <div
              className="rounded-lg border p-3"
              style={{ background: tokens.surface, borderColor: tokens.line }}
            >
              <p className="display text-lg leading-tight" style={{ color: tokens.ink }}>
                {name.trim() || "Eigene Palette"}
              </p>
              <p className="mt-1 text-xs" style={{ color: tokens.inkSoft }}>
                So liest sich ein Rezept in deinen Farben.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: tokens.brand, color: tokens.onBrand }}
                >
                  Gekocht
                </span>
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: tokens.sageSoft, color: tokens.sageText }}
                >
                  4,5 Sterne
                </span>
                <span className="text-xs font-medium" style={{ color: tokens.danger }}>
                  Fehler
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField
              label="Papier"
              hint="Der Grund. Ein dunkler Ton schaltet die App auf Dunkel."
              value={draft.paper}
              onChange={(next) => update({ paper: next })}
            />
            <ColorField
              label="Tinte"
              hint="Der Text. Muss sich deutlich vom Papier lösen."
              value={draft.ink}
              onChange={(next) => update({ ink: next })}
            />
            <ColorField
              label="Hauptfarbe"
              hint="Knöpfe, Links und der Fokusring."
              value={draft.brand}
              onChange={(next) => update({ brand: next })}
            />
            <ColorField
              label="Zweitfarbe"
              hint="Gekocht-Status, Bewertungen und ruhige Flächen."
              value={draft.sage}
              onChange={(next) => update({ sage: next })}
            />
          </div>

          <div className="space-y-1.5 rounded-xl border border-line bg-surface/60 p-3">
            <ContrastRow label="Tinte auf Papier" ratio={contrastRatio(tokens.ink, tokens.paper)} />
            <ContrastRow
              label="Schrift auf der Hauptfarbe"
              ratio={contrastRatio(tokens.onBrand, tokens.brand)}
            />
            <ContrastRow
              label="Zweitfarbe als Text auf Papier"
              ratio={contrastRatio(tokens.sageText, tokens.paper)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2">
            <span className="text-xs text-ink-soft">Zueinander</span>
            <span className="flex items-center gap-2 text-xs">
              <span className="font-medium text-ink">
                {harmony.relation} · {harmony.hueGap}°
              </span>
              <Badge tone={harmony.competing ? "danger" : "sage"}>
                {harmony.competing ? "gleich stark" : "stimmt"}
              </Badge>
            </span>
          </div>
          {harmony.competing && (
            <p className="text-[0.7rem] leading-relaxed text-ink-soft">
              Beide Farben tragen gleich viel Gewicht. Ein Helligkeits- oder Sättigungssprung trennt
              sie, oder ein größerer Farbabstand von mindestens 150°.
            </p>
          )}

          <Field label="Name (optional)" hint="Erscheint in deiner Farbliste.">
            <Input
              value={name}
              maxLength={40}
              placeholder="Eigene Palette"
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
                dirtyRef.current = true;
                preview({
                  preset: "custom",
                  colors: draft,
                  name: event.target.value.trim() || "Eigene Palette",
                });
              }}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void commitCustom()} disabled={!dirty}>
              {dirty ? "Palette speichern" : "Gespeichert"}
            </Button>
            <Button variant="secondary" onClick={discard}>
              Verwerfen
            </Button>
            <span className="text-xs text-ink-soft">
              {dirty ? "Vorschau — noch nicht gespeichert." : "Gilt auf allen Geräten."}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
