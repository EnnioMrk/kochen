# Rezeptor

A private German recipe PWA for a family and their friends. Members capture
recipes from photos, links, video or text, cook them with timers, keep
variations, rate what they cooked, and build a shopping list.

The app has no public page. Only approved `ennio.vip` accounts reach it.

## What is inside

| Area | Behaviour |
| --- | --- |
| Access | Platform session + 5-minute Ed25519 project JWT. Server verifies offline and checks the `kochen` grant. A German gate talks to the platform account API; the platform overlay is not used. |
| Appearance | Five palettes plus a custom one. A member picks paper, ink, primary and secondary; the app derives every shade, infers light or dark from the paper, and checks WCAG contrast and colour harmony before saving. The choice follows the account. |
| Recipes | Title, description, servings, ingredients, steps, tags, categories, images, source, baking temperature and baking time (free text). Raw text and transcript stay readable. |
| Capture | Photo, PDF, link, video, audio, text. Worker queue with visible position. JSON-LD first, Readability fallback. Audio and video speech go through Parakeet TDT 0.6B v3 (25 European languages, German included). German draft, member confirms before save. A unit stays only when the source states it; a bare count becomes `Stück`. Servings are estimated when the source names none, and the review marks the value as `geschätzt`. Ingredients follow their first mention in the steps. A duration in the step text fills the step timer. A link shared from another app starts a capture at once; the worker finishes it while the app is closed and push announces the draft. |
| Cooking | Step-by-step or full page. Screen wake lock. One timer per step, running after reload. On a phone a check-off moves to the next step. A step with a duration starts its timer at that duration; a step without one asks for minutes. Servings scale with practical rounding (`4 ½` eggs, never `1 ⅓`). |
| Cook state | Per person: untested, count, last cooked. A rating needs a cook event. Half stars. One rating per person and recipe. |
| Variations | Fork keeps `lineage_key` per line. Unlimited chain. Side-by-side diff. Predecessor drift banner. |
| Social | QR friend invite with two-sided confirmation. Profiles, friend list visibility, comments with one reply level, private links (login required, read and comment only). |
| Link previews | A shared recipe or invite link shows its title, description and cover in WhatsApp, Telegram and iMessage. The bare site link shows a 1200x630 brand card. |
| Search | One natural-language field. The model emits a strict filter DSL. Code compiles it to parameterized SQL. No keyword fallback. |
| Shopping | Several recipes and servings. The member's own latest variation supplies the amounts. Equal units merge; teaspoon and tablespoon stay apart. |
| Notifications | Web Push + bell list. Comment, reply, friend request, accepted request, new variation, timer end, finished import. No email. |
| Print and export | A4 print route, Chromium PDF in the worker, Markdown export. |
| Theme | Five palettes and a custom one from four colours. Runtime tokens, no raw colour in a component. Dark mode follows the paper. The choice follows the account. |
| Hardening | `noindex` on every response, `robots.txt` disallow, one visibility policy, soft delete, German only. |
| Updates | Each build writes its id to `/version.json`. An open page compares itself with the live id and shows a reload strip when a newer build is live. |

## Stack

- TypeScript everywhere.
- `apps/web`: Bun + Hono for API and SPA, React 19, Vite, TanStack Query, Tailwind v4.
- `apps/worker`: Node 22, sharp, ffmpeg, pdftoppm, yt-dlp, Chromium, web-push.
- `asr`: NVIDIA Parakeet TDT 0.6B v3 (q8_0 GGUF) on the
  `ghcr.io/mudler/parakeet.cpp-server` CPU image, OpenAI-compatible
  `/v1/audio/transcriptions`, internal only.
- PostgreSQL 17. Plain SQL migrations. `postgres.js` for queries (Drizzle was dropped in favour of explicit SQL so the recursive rating rule and the filter compiler stay in one place).
- `packages/contracts` (Zod), `packages/core` (rules with tests), `packages/db` (client + migrations), `packages/ai` (provider adapter).

```
phone / tablet / laptop
  React PWA  ──Bearer JWT──►  rezeptor.ennio.vip  (Bun + Hono)
      │                          │        │
      │                          │        └── Postgres
      │                          └──────────► R2 or a mounted media volume
      └── auth.js overlay ──► api.ennio.vip

  worker (Node 22) ──► Postgres jobs ──► AI, ffmpeg, yt-dlp, sharp, web-push, Chromium
```

## Local development

Prerequisites: Bun 1.4+, PostgreSQL 17, Node 22 for the worker.

```bash
bun install
createdb rezeptor

export DATABASE_URL=postgres://rezeptor:rezeptor@localhost:5432/rezeptor
bun run scripts/migrate.ts

# API on :3000, dev auth enabled
DEV_AUTH=true PORT=3000 bun run apps/web/src/server/index.ts

# SPA on :5173 (proxy to :3000)
bun run --cwd apps/web dev

# Worker
bun run apps/worker/src/index.ts
```

A dev bearer token has the form `dev:<sub>:<email>:<name>`.
`DEV_AUTH=true` is ignored when `NODE_ENV=production`.

Set the AI variables for capture, AI answers, tag suggestions and search:

```
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://opencode.ai/inference/go/openai/v1
OPENAI_MODEL=deepseek-v4.1-flash
OPENAI_SESSION_ID=<stable uuid per app>
```

`AI_PROVIDER=gemini` with `GEMINI_API_KEY` also works. Without a key, only the
AI surfaces fail with `ai_unavailable`; every other function keeps working.

### R2 bucket CORS

The browser uploads a photo straight to R2 with a presigned `PUT`. The bucket
must allow that cross-origin request. Without the policy the presign answers
`200`, the browser blocks the `PUT`, and no file arrives from any device.

The app's own R2 keys cannot change a bucket policy; S3 answers
`PutBucketCors` with `AccessDenied`. Use a Cloudflare API token with R2 edit
rights:

```bash
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... R2_BUCKET=kochen \
APP_ORIGIN=https://rezeptor.ennio.vip bun run r2:cors
```

The script writes the policy and reads it back. The policy allows `PUT`,
`GET` and `HEAD` from `APP_ORIGIN`, `https://rezeptor.ennio.vip` and
`http://localhost:5173`, with the `content-type` header and a one-hour cache.
The dashboard does the same job.

### Link previews

`apps/web/src/server/preview.ts` fills the Open Graph tags for the two routes a
member shares: `/r/<id>?link=<token>` and `/f/<token>`. It replaces the marked
block in the built page, so the crawl sees the recipe title and a cover card.
A crawler has no session, so the link token is the credential and it is checked
again for `/r/<id>/preview.jpg`.

The static card lives in `apps/web/public/og/`. Regenerate it after a brand
change:

```bash
cd apps/web && bun run scripts/og-cards.mjs   # needs Chromium
```

### Tests

```bash
bun run test       # core rules: units, ratings, visibility, diff, filter, shopping, normalizer
bun run typecheck  # tsc over all workspaces
```

API smoke test: start the API with a real database and use the endpoints in
`apps/web/src/server/routes/`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_ORIGIN` | Canonical origin, `https://rezeptor.ennio.vip` |
| `CANONICAL_HOST` | `rezeptor.ennio.vip`; every other host answers 301 |
| `ENNIO_JWKS_URL` | Platform JWKS |
| `ENNIO_AUD` | `kochen` |
| `DEV_AUTH` | Local only; `true` enables `dev:` tokens |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION` | Cloudflare R2 |
| `MEDIA_DIR`, `MEDIA_SECRET` | Local media volume when R2 is absent |
| `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_SESSION_ID`, `GEMINI_API_KEY` | AI |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `ASR_BASE_URL`, `ASR_MODEL`, `ASR_LANGUAGE`, `ASR_API_KEY` | Parakeet ASR endpoint (internal `http://kochen-asr:8080/v1`) |
| `CHROMIUM_PATH` | Worker PDF render |
| `PORT` | Web port, default 3000 |

Generate VAPID keys:

```bash
cd apps/worker && node -e "console.log(require('web-push').generateVAPIDKeys())"
```

## Deploy

One image, two targets: `web` and `worker`.

```bash
docker build --target web -t kochen-web .
docker build --target worker -t kochen-worker .
```

Dokploy (Ennio, `84.247.128.111`):

- Project `Kochen`.
- `PostgreSQL` service with a volume and a daily backup.
- Application `web`: Git source, Dockerfile target `web`, port 3000, domains
  `rezeptor.ennio.vip`, `rezepte.ennio.vip` and `kochen.ennio.vip`, health
  check `/healthz`.
  The container applies SQL migrations at boot, then serves API and SPA.
- Application `worker`: same repository, Dockerfile target `worker`, no domain.
  One replica. Chromium and ffmpeg need memory.
- Application `asr`: Docker image `ghcr.io/mudler/parakeet.cpp-server:latest`,
  args `--model tdt-0.6b-v3-q8_0.gguf --host 0.0.0.0 --port 8080 --threads 4`,
  volume `parakeet-models` at `/models`, internal only. First start downloads
  the ~650 MB GGUF once.
- R2 bucket `kochen` in EU jurisdiction, endpoint
  `https://<account>.eu.r2.cloudflarestorage.com` with the CORS policy from
  `bun run r2:cors` (see Local development). A new host needs a new origin in
  that policy.
- Dokploy backup `db-backups`, nightly 03:00, 30 kept, to the same R2 bucket.
- DNS: proxied A records for all three hosts to `84.247.128.111`. The wildcard
  still points at the old server, so each record is explicit.
- `rezepte.ennio.vip` and `kochen.ennio.vip` answer a 301 to
  `rezeptor.ennio.vip` inside the app, so all hosts share one deployment and
  one session.

## Security notes

- One `accessFor` policy decides visibility. Routes never filter on their own.
- A private recipe never opens for a non-owner, not by link, search or count.
- Private links store only a SHA-256 hash, never expire, and are revocable.
- Comments and imported text render as plain text. No HTML.
- Link import has an SSRF guard: scheme allowlist, DNS check against private
  ranges, redirect and size caps.
- Prompt injection defense: untrusted text sits in a data fence, the model has
  no tools, and output is limited to the recipe schema or the filter DSL.
- Uploads: magic-byte check, size caps, EXIF strip, pixel limit.
- No secrets in the client bundle. Only the VAPID public key is public.

## Known limits

- Without an AI key the vision/text surfaces are unavailable by design. Audio
  does not depend on it: Parakeet runs separately.
- Parakeet v3 auto-detects the language and has no German hint. Very short or
  noisy clips can switch language; the app stores the transcript for review.
- PDF export renders a worker-side A4 template, not the SPA print route. The
  two layouts share the same rules but can drift; the print route remains the
  preview for browser print.
- YouTube, Instagram and TikTok can block `yt-dlp`. The import tries signed out
  first. A social link works in both the *Link* and *Video* tabs. The order is:
  public caption, then audio and frames, then carousel slides. If the caption
  is thin, the post has no audio or frames, and it contains a recipe link, the
  linked page wins when it has schema.org Recipe data. When the media is
  refused, the caption alone becomes a reviewable draft. The review names what
  was read: caption, subtitles, audio, frames, carousel, or website. A stored
  login under *Einstellungen → Zugänge* stays the optional add-on, with a test
  button.
- The worker image pins `YTDLP_VERSION`. Bump the pin to fetch a newer binary;
  `latest` alone can stay cached for months. The worker gives `yt-dlp` the
  image's node as JS runtime, which YouTube needs for formats.
- Chrome cannot decode HEIC. On such a browser the photo list shows a file tile
  with the name, not a preview. The import still converts the photo in the
  worker.
- The servings estimate is a heuristic from the number of ingredients and
  steps. It is marked `geschätzt` in the review; correct it before you save.
- Baking temperature and baking time come from the source text. The import
  fills them only when the source states them; leave them empty otherwise.
- Uploaded originals are kept. Use an R2 lifecycle rule or an operator decision
  to remove old originals.

## License

Private. All rights reserved.
