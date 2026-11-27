/**
 * Renders the link-preview images into apps/web/public/og/.
 *
 * A chat app does not render SVG, so the card must be a raster file. These
 * files come from this script and are committed; run it again only when the
 * card design or the wordmark changes.
 *
 *   bun run scripts/og-cards.mjs        (from apps/web)
 *
 * Needs Chromium on PATH (or CHROMIUM_PATH) and sharp, which the web app
 * already depends on. The card is a JPEG: a chat app caps the file size.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = join(web, "public/fonts");
const out = join(web, "public/og");
const chromium = process.env.CHROMIUM_PATH ?? "chromium";

const base64 = async (name) => (await readFile(join(fonts, name))).toString("base64");
const [petrona, inter, wordmarkInk, wordmarkCream, icon] = await Promise.all([
  base64("petrona-latin.woff2"),
  base64("inter-latin.woff2"),
  readFile(join(web, "public/brand/wordmark-ink.svg"), "utf8"),
  readFile(join(web, "public/brand/wordmark-cream.svg"), "utf8"),
  readFile(join(web, "public/icon.svg"), "utf8"),
]);

/** A fixed height, and the width from the viewBox aspect (294x43). */
const fit = (svg, height, aspect) =>
  svg.replace(/<svg[^>]*>/, (tag) => `${tag} width="${Math.round(height * aspect)}" height="${height}"`);

const face = `
  @font-face { font-family: Petrona; font-weight: 400 700; src: url(data:font/woff2;base64,${petrona}) format("woff2"); }
  @font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${inter}) format("woff2"); }
`;

const paper = "#faf7f2";
const ink = "#211c16";
const inkSoft = "#5c5346";
const brand = "#b4552d";
const line = "#e3d9ca";
const surface = "#fffdfa";
const gold = "#c98a2b";

/** 1200x630. A chat shows it about 360 px wide, so the type stays large. */
const site = `<!doctype html>
<html lang="de"><head><meta charset="utf-8" /><style>
  ${face}
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: ${paper};
    color: ${ink};
    font-family: Inter, ui-sans-serif, sans-serif;
    overflow: hidden;
    position: relative;
  }
  .grain { position: absolute; inset: 0; opacity: .5; mix-blend-mode: multiply; }
  .warm {
    position: absolute; width: 720px; height: 720px; right: -180px; top: -260px;
    background: radial-gradient(closest-side, ${brand}26, ${brand}00 72%);
  }
  .content { position: absolute; inset: 0; padding: 74px 80px; display: flex; }
  .left { width: 610px; display: flex; flex-direction: column; }
  .lockup { display: flex; align-items: center; gap: 18px; margin-bottom: 34px; }
  .lockup .icon svg { display: block; width: 54px; height: 54px; }
  .lockup .mark svg { display: block; height: 26px; width: auto; }
  h1 {
    font-family: Petrona, Georgia, serif; font-weight: 600;
    font-size: 96px; line-height: 1.01; letter-spacing: -.025em;
    margin-top: 0;
  }
  .lead {
    font-size: 27px; line-height: 1.46; color: ${inkSoft}; max-width: 560px; margin-top: 28px;
  }
  .foot { margin-top: auto; display: flex; align-items: center; gap: 16px; }
  .rule { width: 54px; height: 2px; background: ${brand}; border-radius: 2px; }
  .domain { font-size: 21px; font-weight: 600; letter-spacing: .02em; color: ${inkSoft}; }
  .stack { position: relative; flex: 1; margin-left: 24px; margin-top: 6px; }
  .card {
    position: absolute; width: 318px; height: 402px; border-radius: 24px;
    border: 1px solid ${line}; background: ${surface};
    box-shadow: 0 30px 60px -30px #211c1640, 0 8px 18px -12px #211c1633;
    padding: 30px 28px;
  }
  .card.back { right: 178px; top: 58px; transform: rotate(-8deg); background: #f4ece0; }
  .card.mid { right: 52px; top: 96px; transform: rotate(6deg); background: #f8f1e6; }
  .card.front { right: 108px; top: 26px; transform: rotate(-2deg); }
  .tag {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase;
    color: ${brand};
  }
  .tag i { width: 8px; height: 8px; border-radius: 50%; background: ${brand}; display: block; }
  .dish {
    font-family: Petrona, Georgia, serif; font-size: 31px; line-height: 1.14;
    margin-top: 14px; color: ${ink};
  }
  .bar { height: 9px; border-radius: 6px; background: ${line}; margin-top: 12px; }
  .bar.w70 { width: 70%; } .bar.w88 { width: 88%; } .bar.w54 { width: 54%; }
  .photo {
    margin-top: 18px; height: 150px; border-radius: 16px;
    background: linear-gradient(135deg, ${brand} 0%, #cf7a4a 55%, ${gold} 100%);
    position: relative; overflow: hidden;
  }
  .photo::after {
    content: ""; position: absolute; inset: auto -30px -60px auto;
    width: 170px; height: 170px; border-radius: 50%; background: ${paper}22;
  }
  .photo::before {
    content: ""; position: absolute; left: 22px; top: 22px;
    width: 46px; height: 46px; border-radius: 50%; background: ${paper}33;
  }
  .bookmark {
    position: absolute; right: 40px; top: 0; width: 26px; height: 62px;
    background: ${gold}; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%);
    border-radius: 0 0 2px 2px;
  }
</style></head>
<body>
  <div class="warm"></div>
  <svg class="grain" width="1200" height="630" aria-hidden="true">
    <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0" /></filter>
    <rect width="1200" height="630" filter="url(#n)" opacity=".055" />
  </svg>
  <div class="content">
    <div class="left">
      <div class="lockup"><span class="icon">${icon}</span><span class="mark">${fit(wordmarkInk, 26, 294 / 43)}</span></div>
      <h1>Rezepte,<br />die bleiben.</h1>
      <p class="lead">Rezepte sammeln, mit Freunden teilen<br />und Schritt für Schritt kochen.</p>
      <div class="foot"><span class="rule"></span><span class="domain">rezeptor.ennio.vip</span></div>
    </div>
    <div class="stack">
      <div class="card back"></div>
      <div class="card mid"></div>
      <div class="card front">
        <div class="bookmark"></div>
        <div class="tag"><i></i>Ofengericht</div>
        <div class="dish">Ofengemüse<br />mit Feta</div>
        <div class="photo"></div>
        <div class="bar w88"></div>
        <div class="bar w70"></div>
        <div class="bar w54"></div>
      </div>
    </div>
  </div>
</body></html>`;

/** 400x104, transparent: it sits on a cover photo, bottom left. */
const stamp = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  ${face}
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 280px; height: 88px; background: transparent; }
  .chip {
    display: inline-flex; align-items: center;
    height: 68px; padding: 0 26px; margin: 10px 0 0 0; white-space: nowrap;
    border-radius: 999px;
    background: #211c1699;
    border: 1px solid #faf7f23d;
    box-shadow: 0 10px 26px -12px #211c168c;
  }
  .chip svg { display: block; height: 26px; width: auto; }
</style></head>
<body><div class="chip">${fit(wordmarkCream, 26, 294 / 43)}</div></body></html>`;

async function shoot(html, file, { width, height, transparent = false }) {
  const page = join(out, `.${file}.html`);
  await writeFile(page, html);
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    `--screenshot=${join(out, file)}`,
  ];
  if (transparent) args.push("--default-background-color=00000000");
  try {
    await run(chromium, [...args, `file://${page}`], { timeout: 90_000 });
  } finally {
    await rm(page, { force: true });
  }
}

await mkdir(out, { recursive: true });
// A chat app accepts PNG, but the flat card is 350 KB as PNG and 50 KB as JPEG.
await shoot(site, ".site.png", { width: 1200, height: 630 });
await sharp(join(out, ".site.png"))
  .jpeg({ quality: 88, mozjpeg: true, progressive: true })
  .toFile(join(out, "site.jpg"));
await rm(join(out, ".site.png"), { force: true });
await shoot(stamp, "stamp.png", { width: 280, height: 88, transparent: true });
console.log("wrote apps/web/public/og/site.jpg and stamp.png");
