# Colour research for Rezeptor

**Question.** Which colours fit a private German family cookbook PWA, and why did the
original terracotta-and-sage pair read as a mismatch?

**Answer in one line.** Terracotta is the right identity colour, but it needs a quiet
counterpoint, not a second earth tone of the same weight. The app now pairs it with a
deep muted teal.

## The incumbent pair, measured

Values are OKLCH (lightness 0–1, chroma 0–0.4, hue in degrees) and WCAG contrast.

| Colour | Hex | Lightness | Chroma | Hue |
| --- | --- | --- | --- | --- |
| Terracotta (primary) | `#b4552d` | 0.56 | 0.135 | 42° |
| Olive (old secondary) | `#63714f` | 0.53 | 0.054 | 126° |

- Hue distance: 84°.
- Lightness gap: 0.03.
- Contrast between the two colours: **1.07:1**.

Two chromatic colours of nearly equal lightness and mid chroma make each other look
dirtier. Josef Albers describes this as simultaneous contrast: the eye pushes each
colour toward the other's opposite, so the pair vibrates instead of settling. The old
pair was also used at the same visual weight: links, the switch, the cooked mark, the
avatar and the success toast all sat at the same value. Nothing led.

The hue gap is not the main problem. Olive and terracotta are a documented earth
combination. The failure is **equal value and equal role**, not the hue itself.

## What the sources say

- Terracotta pairs with olive, sage, navy, cream and mustard. Design guides add one
  condition: pair it with earth tones of **similar saturation** and let ivory or brown
  carry the balance. The old pair broke that condition: 0.135 chroma against 0.054.
- Teal, muted turquoise and blue-green are named as the cooler complement that makes
  terracotta look warmer without competing with it. Muted complementary pairs are the
  usual fix for "warm colour plus green looks muddy".
- OKLCH is perceptually uniform: equal lightness values look equal, and chroma can be
  compared across hues. That makes the "one actor, one support" rule measurable
  instead of a matter of taste.
- In food settings, warm colours carry appetite and comfort; green and teal read as
  fresh and calm. A warm primary with a cool supporting accent keeps the appetite cue
  in the action colour and puts calm in the status colour.

## Rules the palette now follows

1. **One actor.** The primary keeps chroma 0.09–0.14. The secondary stays near 0.04–0.09
   and never competes for the same role.
2. **Separate the value.** Primary and secondary must differ by at least 1.25:1, or by
   a clear lightness step. Equal-value accents are rejected by the editor.
3. **Use a clear hue step.** 150–180° reads as complementary. 30–60° reads as
   analogous. 60–150° at equal value reads as mud.
4. **Keep 60-30-10.** Paper and ink dominate. The primary marks actions. The secondary
   marks state: cooked, checked, rating context.
5. **Text stays readable.** Body and small text reach 4.5:1. Focus rings and fills keep
   their own on-colour, chosen from luminance.

## Shipped palettes

| Preset | Primary | Secondary | Hue gap | Primary / secondary contrast | Secondary as text on paper | Role |
| --- | --- | --- | --- | --- | --- | --- |
| Paprika | `#b4552d` terracotta | `#3f5d63` deep teal | 169° | 1.45:1 | 6.65:1 | complementary, one actor |
| Salbeigarten | `#4d6746` herb green | `#b07a4c` clay | 79° | 1.71:1 | 4.63:1 | analogous, value step |
| Leinen | `#2f5d63` petrol | `#b07a4c` clay | 146° | 2.00:1 | 4.63:1 | split complement |
| Safran | `#9a6214` saffron | `#3f5a72` slate blue | 178° | 1.42:1 | 6.63:1 | complementary |
| Espresso | `#e08a5b` apricot | `#6f8f8b` cool teal | 138° | 1.33:1 | 5.26:1 | dark, cool support |

Every palette is generated from four choices — paper, ink, primary, secondary. The
resolver derives recessed paper, hairlines, tints, hover shades and the readable ink on
each fill. Dark mode is inferred from the paper: a paper below 30% relative luminance
switches the whole page to dark.

## The editor carries the rule

A custom palette shows live WCAG ratios and a harmony reading:

- **Verwandt / Analog / Gemischt / Komplementär** with the hue gap.
- **"stimmt"** when the pair has a clear separation.
- **"gleich stark"** when both colours sit at nearly the same value. The hint then asks
  for a lightness, chroma or hue step of at least 150°.

This is the same test that rejected the original terracotta-and-sage pair.

## Sources

- Josef Albers, *Interaction of Color* — simultaneous contrast; equal-value pairs
  vibrate. Summary and exercises:
  <https://jlzych.com/2020/04/29/exercises-from-interactions-of-color-by-josef-albers/>
- Wayfair, *Terracotta Color Palettes to Fall For* — olive, sage, navy, mustard and
  cream pairings; similar-saturation earth tones need a neutral balance:
  <https://www.wayfair.com/sca/ideas-and-advice/guides/terracotta-color-palettes-to-fall-for-T23884>
- Tiptopfurniture, *Colors That Go with Terracotta* — teal and blue-green as the muted
  complement that intensifies terracotta:
  <https://tiptopfurniture.com/colors-that-go-with-terracotta/>
- NineGuides, *Color Psychology in Restaurant Design* — warm colours stimulate appetite;
  green and teal read as fresh; earth tones suit full-service dining:
  <https://nineguides.com/design/color-psychology-dining/>
- Evil Martians, *OKLCH in CSS: why we moved from RGB and HSL* — perceptual lightness,
  chroma consistency and gamut handling:
  <https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl>
- W3C WAI, *Understanding SC 1.4.3 Contrast (Minimum)* — 4.5:1 for text, 3:1 for large
  text and non-text controls:
  <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>

_Measured on 27 November 2026 with the resolver in
`apps/web/src/client/lib/theme.ts`._
