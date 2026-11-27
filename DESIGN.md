# Rezeptor — design system

## World

A printed family cookbook that became an app. Paper, ink, one serif display face and one
sans for reading. Warmth comes from the paper and the primary colour, not from
decoration. Surfaces are quiet; cooking mode is the loudest screen.

## Colour

Four decisions produce the whole page:

| Decision | Role |
| --- | --- |
| Paper | Page background. Its luminance decides light or dark mode. |
| Ink | Text and contrast anchor. |
| Primary | Actions, links, focus. |
| Secondary | Cooked state, checks, quiet accents. |

Every other value is derived in `apps/web/src/client/lib/theme.ts`:

- `paper2` — recessed surface, below the page in both modes.
- `surface` — cards, inputs, menus; slightly above the page.
- `inkSoft` — secondary text, held at 4.5:1.
- `line` — hairlines.
- `brandDark` — hover; darker in light mode, lighter in dark.
- `brandSoft`, `sageSoft` — tinted fills. Badges use a 10% mix of the fill.
- `onBrand`, `onSage`, `onDanger`, `onInk` — the readable text for each fill.
- `sageText`, `goldText` — accent colours pushed to 4.6:1 on paper.
- `knob` — switch handle, white in light mode and ink in dark.

The resolver writes these as `--color-*` custom properties on `<html>` at runtime.
Components use Tailwind utilities such as `bg-surface`, `text-ink-soft`,
`border-line`, `text-on-brand`. A raw colour in a component is a defect.

### Harmony rules

1. One actor: the primary carries 0.09–0.14 chroma; the secondary stays quieter.
2. Value separation: primary and secondary differ by at least 1.25:1, or by a clear
   lightness step.
3. Hue step: 150–180° complementary, 30–60° analogous, 60–150° only with a value step.
4. 60-30-10: paper and ink dominate; primary for actions; secondary for state.
5. 4.5:1 for text, 3:1 for icons and non-text controls.

### Presets

| Preset | Mode | Primary | Secondary | Relation |
| --- | --- | --- | --- | --- |
| Paprika | light | terracotta `#b4552d` | deep teal `#3f5d63` | complementary, 169° |
| Salbeigarten | light | herb green `#4d6746` | clay `#b07a4c` | analogous, 79° |
| Leinen | light | petrol `#2f5d63` | clay `#b07a4c` | split complement, 146° |
| Safran | light | saffron `#9a6214` | slate blue `#3f5a72` | complementary, 178° |
| Espresso | dark | apricot `#e08a5b` | cool teal `#6f8f8b` | split complement, 138° |

A custom palette uses the same four inputs. The editor shows WCAG ratios and a harmony
reading, and warns when both colours carry the same weight.

## Type

- Display: Petrona 600 for h1–h3 and `.display`.
- Body: Inter 400/500/600.
- Sizes are rem-based; no fixed pixel text.
- Numbers that line up use `tabular-nums`.

## Layout

- Phone first; test at 390 px and 1440 px.
- Content column max 6xl in the shell, 2xl on settings.
- 44 px touch targets on coarse pointers.
- Safe-area insets on the header, bottom navigation and fixed cook bar.

## Components

- **Card**: `bg-surface/80`, `border border-line`, radius `--radius-card`, blur.
- **Button**: primary = brand fill + `on-brand`; secondary = surface + line; ghost for
  quiet actions; danger and sage for their states.
- **Badge**: soft tint + its `-text` token.
- **Switch**: sage track, knob token, focus ring.
- **Focus**: one visible ring in brand, offset 2 px.
- **Print**: the A4 sheet is forced to black on white.

## State

- Hover only under `(hover: hover)`.
- Transitions 180 ms with a mild ease; reduced motion collapses every animation.
- Skeletons match the final layout.
- Empty states keep the same frame as filled lists.

## Copy

German, plain, short. State the rule instead of hiding it. No exclamation marks.

## Anti-patterns

- Two accents of equal weight.
- A fill colour used as text.
- Decorative gradients or glass panels.
- Raw hex values in components.
- Renaming the established tokens; other surfaces and the tutorial depend on them.
