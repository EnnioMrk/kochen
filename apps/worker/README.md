# Kochen worker

Background worker for imports, PDF export, timers and Web Push. It claims jobs
from Postgres (`jobs`), does the media and AI work, and writes the result back.
No Redis, no second queue service.

Runs on Node 22 (production image) and also under Bun for local development.
Entry point: `src/index.ts`.

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `APP_ORIGIN` | yes | Canonical origin for push deep links, e.g. `https://rezepte.ennio.vip`. |
| `R2_ENDPOINT` | yes | S3-compatible endpoint of the bucket. |
| `R2_BUCKET` | yes | Bucket name (default `kochen`). |
| `R2_ACCESS_KEY_ID` | yes | R2 access key. |
| `R2_SECRET_ACCESS_KEY` | yes | R2 secret. |
| `R2_REGION` | no | Default `auto`. |
| `GEMINI_API_KEY` | one AI key | Gemini provider (default). |
| `OPENAI_API_KEY` | one AI key | OpenAI fallback when `AI_PROVIDER=openai` or no Gemini key. |
| `AI_PROVIDER` | no | `gemini` (default) or `openai`. |
| `AI_EXTRACTION_MODEL` | no | Pinned extraction model. |
| `AI_TEXT_MODEL` | no | Pinned text/answer model. |
| `VAPID_PUBLIC_KEY` | for push | Web Push public key. |
| `VAPID_PRIVATE_KEY` | for push | Web Push private key. |
| `VAPID_SUBJECT` | no | Default `mailto:admin@ennio.vip`. |
| `CHROMIUM_PATH` | no | Default `chromium`. In the image `/usr/bin/chromium`. |
| `WORKER_POLL_MS` | no | Idle poll interval, default `2000`. |
| `WORKER_TMP_DIR` | no | Scratch directory for pdftoppm/ffmpeg/Chromium, default `/tmp`. |
| `LOG_LEVEL` | no | Pino level, default `info`. |

Secrets stay in the environment. The worker never logs tokens, private link
tokens, recipe text, transcripts or job payloads.

## Local run

```bash
# from the repository root
bun install
DATABASE_URL=postgres://kochen:kochen@localhost:5432/kochen \
APP_ORIGIN=http://localhost:5173 \
bun run apps/worker/src/index.ts
```

Node instead of Bun:

```bash
cd apps/worker
DATABASE_URL=... npx tsx src/index.ts
```

The worker needs a migrated database and at least one queued job. It exits
cleanly on `SIGTERM` / `SIGINT` after the current job.

## External binaries

Everything is guarded: a missing binary fails the job with a German message and
`error_code: "tool_missing"` instead of crashing the process.

| Tool | Used for | Debian package |
| --- | --- | --- |
| `sharp` (npm) | image decode, EXIF strip, resize, HEIC/HEIF | prebuilt binary |
| `heic-convert` (npm) | HEIC fallback when sharp has no libheif | — |
| `pdftoppm` | PDF pages at 200 DPI | `poppler-utils` |
| `ffmpeg` | 16 kHz mono audio, frames, compression | `ffmpeg` |
| `ffprobe` | audio duration | `ffmpeg` |
| `yt-dlp` | video metadata, audio, captions, frames | release binary |
| `chromium` | A4 PDF export | `chromium` |

## Job kinds

| `kind` | Payload | Result |
| --- | --- | --- |
| `import_photo` | `{kind:"photo", keys:[r2Key]}` | `needs_review` with normalized draft, 320/800/1600 JPEG variants |
| `import_pdf` | `{kind:"pdf", keys:[r2Key]}` | `needs_review`, first page as cover |
| `import_link` | `{kind:"link", url}` | `needs_review`; JSON-LD first, Readability + model as fallback |
| `import_video` | `{kind:"video", url}` or `{kind:"video", keys:[r2Key]}` | `needs_review`; duration check, audio, captions, up to 12 frames |
| `import_audio` | `{kind:"audio", keys:[r2Key]}` | `needs_review`; verbatim transcript, then extraction |
| `import_text` | `{kind:"text", text}` | `needs_review` |
| `export_pdf` | `{recipeId}` | `done` with `payload.resultKey` (`exports/<recipeId>/<ts>.pdf`) |
| `timer` | `{timerId}` | `done`; notification + push, idempotent via `timer:<id>` |
| `push` | `{notification:{kind,payload}}` | `done`; Web Push to every live subscription |

Import state sequence: `queued → fetching → normalizing → understanding →
needs_review` (or `failed`). See `TECH.md` §7.

### Import result payload

`payload.draft` is the normalized `RecipeInput` JSON. `payload.warnings` is a
list of German sentences, `payload.asksForScreenshot` tells the UI to ask for a
screenshot instead of guessing, and `payload.sourceLang` keeps the original
language. `payload.rawText` / `payload.transcript` are kept when the source has
them. `payload.keys` holds the display image keys for the confirm step;
`payload.sourceKeys` keeps the original uploads for cleanup.

## Limits and retries

Limits come from `app_settings` key `limits` (`DEFAULT_LIMITS` if unreadable):
max video/audio minutes, photo count and size, total size, PDF pages. A rejection
fails with `limit_exceeded` and a German message that names the limit and the
actual value. Videos are never cut.

A claimed job increments `attempts`. On failure:

- retryable codes: `extraction_failed`, `ai_unavailable`, `source_unavailable`,
  `export_failed`, `internal` — up to 3 attempts, backoff
  `run_at = now() + attempts × 30 s`, state back to `queued`;
- permanent codes: `limit_exceeded`, `invalid_source`, `tool_missing`,
  `media_unavailable` — `failed` immediately.

Claiming uses one statement with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`, so
several workers can run side by side. A lock older than 60 minutes is reclaimed.

## Error codes

`limit_exceeded`, `invalid_source`, `source_unavailable`, `extraction_failed`,
`ai_unavailable`, `media_unavailable`, `tool_missing`, `export_failed`,
`internal`. The UI maps each code to German text; `last_error` already carries a
German sentence.

## Notes and known risks

- HEIC needs libheif in the sharp build; `heic-convert` is the fallback and adds
  a warning to the result.
- Video downloads depend on yt-dlp and on the platform not blocking the server.
  Instagram/TikTok may still refuse; the job fails with a clear message.
- Audio and video clips above ~18 MB are re-encoded to mono MP3 64k so they fit
  the inline model request; the full wav is never stored.
- PDF page images are only intermediate; only the first page is kept as cover.
- The web delete endpoint removes `payload.keys`; originals in
  `payload.sourceKeys` stay in the bucket until the storage lifecycle rule
  handles them.
