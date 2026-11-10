# Kochen — Technology Decisions

Deep dive per concern. Each section gives the choice, the reason, the rejected
alternatives and the risk.

Version 1. German UI only.

## 0. Ground truth

These facts are verified against the live platform and the `portfolio` source.

- `ennio.vip` runs a shared account service at `https://api.ennio.vip/v1`.
- Session cookie: `ennio_session`, `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Domain=.ennio.vip`. Every `*.ennio.vip` host sends it.
- The drop-in client is `https://api.ennio.vip/v1/auth.js`
  (`window.EnnioAuth`). It draws the login sheet, the access-request sheet and
  fills `[data-ennio-*]` nodes.
- A subpage asks for a short JWT: `EnnioAuth.token("kochen")`.
  Claims: `sub`, `email`, `name`, `role`, `projects`, `iss`, `aud`, `exp`.
  Lifetime 5 minutes. Ed25519. `aud` is the project slug.
- The backend verifies the token with the public key from
  `https://api.ennio.vip/v1/.well-known/jwks.json` (kid `ennio-1`). No round
  trip per request.
- Access is a platform grant. The operator answers requests in the
  `ennio.vip` admin. `projects` in the token lists the granted slugs.
- `kochen` is not yet a registered project. `GET /v1/projects/kochen` answers
  404. Registration is a setup task: slug `kochen`, `requires_auth = true`,
  `gated = true`, subdomain `rezepte.ennio.vip`.
- The API allows the origins `https://rezepte.ennio.vip` and
  `https://kochen.ennio.vip` with credentials.
- Wildcard `*.ennio.vip` still points to the old server. A new subdomain
  needs an explicit proxied A record to `84.247.128.111`.

Hosts:

- `rezepte.ennio.vip` is the canonical host. All links, QR codes, private
  links and tokens use it.
- `kochen.ennio.vip` stays available and answers a 301 redirect to the
  canonical host. The spec address keeps working. The redirect runs in the
  app (host check), so both hosts share one deployment and one cookie.

Consequence: Kochen builds no login, no signup and no access-request list.
The platform owns them.

## 1. Shape

```
phone / tablet / laptop
  React PWA  ──Bearer JWT──►  rezepte.ennio.vip  (Bun + Hono)
      │                          │        │
      │                          │        └── Postgres (Dokploy service)
      │                          └──────────► R2 (media)
      │
      └── auth.js overlay ──► api.ennio.vip (session, token, grants)

  worker (Node 22)  ──►  Postgres jobs  ──►  AI, ffmpeg, yt-dlp, sharp, web-push, Chromium
```

Two images from one repository: `web` (static files + API) and `worker`
(media and AI jobs). One database. No Redis. No second service to operate.

## 2. Runtime and language

**Decision:** TypeScript everywhere. Bun for `web`, Node 22 for `worker`.

- One language removes duplicate models and contracts. The platform already
  uses Bun + Hono + Drizzle + Postgres, so the team pattern carries over.
- Bun serves the built SPA and the API from one process. Static files, HTTP
  and Postgres are its strong path.
- The worker runs on Node 22. `sharp`, Playwright and `yt-dlp` are Node-first.
  Playwright under Bun is not a supported target. Reliability wins over one
  runtime.
- Shared packages: `db` (schema and queries), `contracts` (Zod), `core`
  (units, ratings, diff, filter compiler), `ai` (prompts and providers).

**Rejected:** Next.js (no SEO, no SSR need, extra server runtime); Python
service (a second language for one AI path, when hosted models do the work);
Go (no gain at this size).

**Risk:** Two runtimes. Mitigation: one shared `core` package, the same
Vitest suite, and one `docker build` target per runtime.

## 3. Frontend

**Decision:** React 19 + TypeScript + Vite + React Router + TanStack Query +
Tailwind CSS v4 + Radix primitives (shadcn style) + `lucide-react` icons.

- SPA. The app is behind a login, has no public page and no SEO. Server
  rendering adds a second render path for zero benefit.
- TanStack Query owns server state: caching, retries, invalidation, polling
  for import jobs. No global store for server data.
- Local cooking state (checked steps, active timers, chosen view) lives in a
  small `useReducer` context, saved to `sessionStorage` so a reload does not
  lose the session.
- Forms: React Hook Form + Zod. One schema, shared with the API.
- German only: no i18n framework. One `de.ts` dictionary, `Intl` for numbers,
  dates and plurals (`de-DE`, `Europe/Berlin`). A string table keeps the
  `localize` path open.
- Styling: Tailwind tokens in CSS variables. Print styles live in the same
  stylesheet (see §13).

**Rejected:** Next.js; Redux (no need); component libraries with their own
design language (the app must look like one product); runtime i18n.

**Risk:** iOS Safari is the strictest target. Test on a real iPhone, not only
in an emulator.

## 4. API layer

**Decision:** Hono on Bun. Zod validators. Hono RPC client (`hc`) for typed
calls. Plain routes for upload, print, push and webhooks.

- Hono is the platform stack. It is small, fast and runs on Bun.
- Hono RPC gives end-to-end types without a second protocol. Plain `fetch`
  routes stay for binary and streaming responses.
- Every route returns one envelope: `{ ok, data }` or `{ ok, error, code }`,
  same as the platform.
- Errors carry a stable `code` (for example `ai_unavailable`,
  `limit_exceeded`, `not_member`). The UI maps codes to German text.
- Auth middleware runs on every `/api/*` route:
  1. Read `Authorization: Bearer`.
  2. Verify Ed25519 with cached JWKS (`jose`), check `aud === "kochen"`,
     `exp`, `iss`.
  3. Accept `projects.includes("kochen")` or `role` owner/admin.
  4. Upsert the local `users` row by `sub`.
  Reject with 401 (no or bad token) or 403 (no grant).
- A second policy module `canView(user, recipe)` decides visibility. No route
  builds its own visibility query.

**Rejected:** tRPC (another layer when Hono already types the client); GraphQL
(one client, no need); cookie auth for the API (the platform cookie is
`SameSite=Lax` and shared; a bearer JWT is explicit and aud-scoped).

**Risk:** A 5-minute token expires mid-action. The client refreshes at 4
minutes and retries one 401 once.

## 5. Data layer

**Decision:** PostgreSQL 17 (Dokploy service) + Drizzle for queries + plain SQL
migrations.

- Relational data with chains, ratings and grants. Postgres handles the
  recursive rating rule in one query.
- Drizzle matches the platform. Hand-written SQL for constraints, triggers and
  recursive CTEs; Drizzle for ordinary reads and writes.
- `pg_trgm` for tag similarity ("no old tag fits") and typo tolerance.
- No vector database. The AI filter compiles to SQL over tags, categories and
  ratings. Embeddings add cost and a second index for no V1 requirement.
- One database, one backup job.

### Core tables (sketch)

```
users(id, platform_sub unique, email, name, role, deleted_at)
recipes(id, owner_id, title, description, servings, source_type, source_url,
        raw_text, transcript, original_lang, visibility,
        baking_temperature, baking_time,
        parent_id, root_id, depth, forked_at,
        archived_at, deleted_at, created_at, updated_at)
recipe_ingredients(id, recipe_id, position, amount numeric, unit_id,
                   name, note, lineage_key)
recipe_steps(id, recipe_id, position, text, duration_s, lineage_key)
units(id, key, label, dimension, factor, round_step, merge_group)
tags(id, slug, label)
recipe_tags(recipe_id, tag_id, confirmed_by)
categories(id, owner_id, name)
recipe_categories(recipe_id, category_id)
images(id, recipe_id, r2_key, width, height, kind, position)
cook_events(id, user_id, recipe_id, cooked_at)
ratings(user_id, recipe_id, stars numeric(2,1), updated_at,
        unique(user_id, recipe_id))
comments(id, recipe_id, author_id, parent_id, body, created_at, deleted_at)
private_links(id, recipe_id, token_hash unique, created_by, revoked_at)
friendships(user_low, user_high, status, requested_by, created_at)
friend_invites(id, owner_id, token_hash, expires_at, used_at)
notifications(id, user_id, kind, payload jsonb, read_at, created_at, dedupe_key)
push_subscriptions(id, user_id, endpoint, keys jsonb, ua, failed_at)
jobs(id, kind, payload jsonb, state, run_at, attempts, locked_at, last_error)
app_settings(key, value)
```

Rules that live in the database, not only in code:

- `ratings.stars` in `(0.5, 1, ..., 5)`; one row per user and recipe.
- A rating needs a cook. Enforce in the same transaction, and by a trigger
  that rejects a rating without `cook_events`.
- `cook_events` is append-only. `count` and `last_cooked` are a view or a
  maintained summary.
- `recipes.root_id` and `depth` are set at fork; the chain is a recursive CTE
  on `parent_id`.
- Delete is `archived_at` or `deleted_at`. No `DELETE` from recipe tables.

### Snapshots and diff

At fork, copy the recipe, its ingredients and its steps. Every copied line
keeps `lineage_key` of the source line. New lines get a new key.

- Diff = join on `lineage_key`, then compare amount, unit, name and note per
  ingredient; text and duration per step. Lines missing on one side are added
  or removed. Order change is a move, not a change.
- The variation is independent by construction: it owns its rows.
- The diff view compares the variation with the current predecessor. A banner
  shows "predecessor changed since this fork" when the predecessor's
  `updated_at` is newer than `forked_at`.

### Rating chain rule

One recursive CTE walks `parent_id` from the recipe up. It takes the first
rating of the chosen person it finds. No person outside the chain is read.

```
WITH RECURSIVE chain(id, parent_id, depth) AS (
  SELECT id, parent_id, 0 FROM recipes WHERE id = $recipe
  UNION ALL
  SELECT r.id, r.parent_id, c.depth + 1
  FROM recipes r JOIN chain c ON r.id = c.parent_id
)
SELECT ra.stars
FROM chain c JOIN ratings ra ON ra.recipe_id = c.id AND ra.user_id = $person
ORDER BY c.depth
LIMIT 1;
```

The filter uses the same function. The AI never computes this rule.

### Visibility

| Viewer | Private recipe | Non-private recipe |
| --- | --- | --- |
| Owner | read, write | read, write |
| Friend | no | read, comment |
| Member via profile | no | read |
| Friend of a friend in a list | no | no |
| Member with a private link | no (link cannot open it) | read, comment |

Kochen never returns a private recipe to a non-owner. Not by link, not by
search, not by count.

## 6. Auth and access

**Decision:** platform session + 5-minute project JWT. No local passwords.

Client:

```html
<script src="https://api.ennio.vip/v1/auth.js"
        data-project="kochen"
        data-guard="required"
        data-access="required"
        data-mode="overlay"></script>
```

- `data-access="required"` shows the access-request sheet to a signed-in
  person without a grant. The request lands in the operator's queue on
  `ennio.vip`. This is requirement §2 with no new code.
- `EnnioAuth.token("kochen")` is fetched before the app loads and refreshed
  every 4 minutes. A wrapper adds `Authorization` to every call.
- `EnnioAuth.user` is for display only. The server trusts the token.
- Sign-out calls `EnnioAuth.logout()`. The app clears its cache.

Server: verify the JWT offline. Check `aud`, `exp`, `iss`, and the grant.
Cache JWKS for one hour; refetch on an unknown `kid`.

**Rejected:** own auth (duplicate accounts, duplicate password rules); trusting
`auth.hasAccess` in the client (it hides UI, it protects nothing).

**Setup task:** register the project with slug `kochen`,
`requires_auth = true`, `gated = true`. Without this, `token("kochen")` has no
`kochen` in `projects` and every request is 403.

**Risk:** the platform token carries `sub`, `email`, `name` and `role`. It does
not carry an avatar. Avatar comes from `/v1/auth/session` on the client, or is
omitted.

## 7. Media and capture

**Decision:** direct upload to Cloudflare R2 with presigned PUT; processing in
the worker; `sharp` + `ffmpeg` + `yt-dlp`.

- R2: S3 API, no egress fee, EU jurisdiction option, private bucket. Signed
  GET URLs, 1 hour. No media on the app server.
- Upload path: browser asks `POST /api/imports/uploads/presign`, sends the file
  to R2, then `POST /api/imports` with the keys. The API checks size, count and
  type before it creates a job.
- The bucket needs a CORS policy for the browser `PUT`. Without it the presign
  answers 200, the browser blocks the request and the file never arrives. The
  policy is code: `scripts/r2-cors.ts` (`bun run r2:cors`) writes the origins,
  methods and headers through the Cloudflare API. The runtime R2 keys cannot
  change a bucket policy (`AccessDenied`), so the script needs a Cloudflare API
  token with R2 edit rights. The operator runs it once per bucket and after a
  new host.
- The signed content type and the sent `content-type` header are the same
  string. `image/jpg` becomes `image/jpeg`. An empty or generic browser type is
  resolved from the file extension before the allowlist check.
- One error map covers photo and screenshot uploads. It blames the connection
  only when the browser is offline, a timeout fired, or the API never answered.
  A blocked cross-origin `PUT` (status 0, browser online) reads as "the storage
  refused the upload". Every message shows the HTTP status when one exists and
  never shows raw English server text.
- Worker steps: `queued → fetching → normalizing → understanding →
  needs_review → done | failed`. Each step writes state, so the UI can show
  progress.
- Images: HEIC/HEIF from iPhone is converted to JPEG. Use `sharp` with a
  libheif build; fall back to `heic-convert` when the build cannot read HEIC.
  EXIF is stripped. Long edge is capped at 2048 px for the model, and 1600 px
  for display. Variants: 320, 800, 1600.
- A browser that cannot decode HEIC (Chrome) shows a file tile with the name
  in the photo list, not a broken image. The conversion happens on the worker,
  so the import is unaffected.
- A failed object read is a storage failure (`media_unavailable`), not an
  unreadable photo. The two messages stay apart, so the member knows what to
  do.
- PDF: pages rendered at 200 DPI (`pdftoppm` from poppler-utils), max 10
  pages.
- Video: `yt-dlp` for metadata and audio. Duration is checked from metadata
  before download. `ffmpeg` extracts 16 kHz mono audio and 1 frame per 5 s for
  the visual pass. Captions and author comment are fetched when available.
- Queue position: count jobs of the same user with an earlier `created_at` and
  state in (`queued`, `running`). The UI polls every 3 s.
- Limits: values in `app_settings`, read before the job starts. A rejection
  deletes the upload and returns the limit that failed. The UI states the
  limit and the actual value.

**Rejected:** server-proxied uploads (memory, double traffic); local disk
(backup and restore pain); client-side OCR (bad handwriting, slow phones).

**Risk:** Instagram and TikTok block unauthenticated downloads. `yt-dlp`
breaks when a platform changes. Mitigation: a per-source adapter, a clear
error, and the screenshot fallback from the spec. Never cut the video.

**Risk:** 25 MB per recipe and retained originals grow storage. Mitigation:
R2 lifecycle rule for originals older than 12 months is a decision for the
operator, not an automatic delete (the spec keeps originals).

## 8. AI

**Decision:** hosted multimodal models. Provider adapter with two providers.

| Task | Model class | Why |
| --- | --- | --- |
| Photo/PDF to recipe | Gemini Flash class, vision | Handwriting, layout, long context |
| Video to recipe | Gemini Flash class, audio + frames | One call sees speech and picture |
| Verbatim transcript | dedicated ASR (Whisper class) | A chat model paraphrases; the transcript must be verbatim |
| Translation to German | same extraction call | One pass, one schema, less cost |
| Recipe Q&A | Gemini Flash, or Pro for hard cases | Recipe context fits easily |
| Tag/category suggestion | Flash, small prompt | Cheap, fast, easy to validate |
| NL filter | small fast model, JSON only | It emits a filter, not SQL |

- One interface `AiProvider` with `extractRecipe`, `transcribe`,
  `answer`, `suggestTags`, `parseFilter`. Two providers behind it, so a
  provider outage is a config change, not a rewrite.
- Structured output: JSON Schema, temperature 0.2, Zod validation, one repair
  retry. On the second failure the job fails with `extraction_failed`.
- Prompts live in one file per task, versioned. A prompt change is a code
  change with an eval run.
- The extraction result is a **draft**. The user confirms it. New recipes start
  untested. This is requirement §3, and it also hides model errors.

### Import quality

The model output is untrusted. `@kochen/core` repairs it with rules that have
unit tests, before any draft reaches the review:

- **Units.** A unit stays only when the source states it. A bare count becomes
  `stueck` (`2 Äpfel` → `2 Stück Äpfel`). An unknown unit word stays in the
  name, so no information is lost. A unit without an amount is dropped.
- **String lines.** A line such as `200 g Mehl`, `1/2 TL Salz`, `2-3 Äpfel` or
  `1 Dose Tomaten (400 g)` splits into amount, unit and name. Link and JSON-LD
  imports use the same parser.
- **Servings.** A missing source value becomes an estimate from the ingredient
  and step counts: `clamp(round((ingredients + 2 * steps) / 4), 1, 12)`. The
  draft carries `servingsEstimated`, the review shows `geschätzt`, and the first
  edit clears the mark. There is no silent 4.
- **Order.** Ingredients follow their first mention in the steps. Unused
  ingredients follow in source order. The sort is stable and runs once, so a
  manual order in the review is kept after save.
- **Durations.** A duration in the step text (`20 Minuten kühlen`,
  `1 Stunde`, `2-3 Minuten`) fills `duration_s` when the model gave none. A
  model duration wins.
- **Baking.** A conservative scan finds `180 °C Ober-/Unterhitze` and
  `35 Min.` only next to a baking word. Both fields stay null when the source
  is silent.

The prompt states the same rules, but the code enforces them. A prompt change
alone cannot break the shape.
- Models are pinned by name in config, not by "latest". A model upgrade runs
  the eval set first.

### Web pages

1. Fetch the URL with an SSRF guard: http/https only, DNS check against
   private ranges, max 3 redirects, 10 s timeout, 5 MB cap.
2. Parse `application/ld+json` with `@type: Recipe` first. Many recipe sites
   carry the full recipe. This path is free and exact.
3. Fallback: Readability (`@mozilla/readability`) → text → LLM.
4. Keep the raw text and the source URL.

### Prompt injection

Imported pages, comments and captions are untrusted input.

- They go into a `user` message inside a clear data fence.
- No tools are exposed to the extraction call. The model cannot fetch, write
  or call a second model.
- The output is limited to the recipe schema. Unknown fields are dropped.
- The filter model emits only the filter DSL. The compiler accepts known keys
  and rejects the rest.
- No AI action changes data without an explicit user confirmation.

### Failure isolation

- The AI module is imported only by `worker` and by two API routes
  (`/api/ai/answer`, `/api/search`).
- Everything else never touches it. Comments, recipes, cooking, shopping list
  and ratings work when the provider is down.
- Timeout 45 s per call (extraction), 15 s (answer/filter). Circuit breaker
  opens for 60 s after 3 failures.
- AI routes are rate limited per user (20 questions/hour, 30 searches/hour)
  and per IP.

### Cost

Family scale: about 50 imports and a few hundred AI calls per month.
Extraction is 1–3 calls per recipe. Estimate under €15/month at Flash prices.
A single self-hosted Whisper on the VPS would cost more in CPU time and
latency than it saves.

**Rejected:** self-hosted Whisper/PaddleOCR (no GPU, slow, worse handwriting);
LLM-generated SQL (unsafe, untestable); embedding search (no V1 need); one
provider with no fallback.

## 9. Cooking mode

**Decision:** browser APIs, server-scheduled timers.

- Screen stays on: `navigator.wakeLock.request("screen")`. Re-acquire on
  `visibilitychange`. Fallback for browsers without it: a muted, looping
  1-pixel video (the NoSleep method).
- Two views: `Schritt für Schritt` and `Alles auf einer Seite`. One toggle,
  stored per user.
- On a phone the step view advances on a check-off: the next step replaces the
  current one. Unchecking never moves, the last step stays, and desktop keeps
  the manual `Weiter` button. The rule uses `matchMedia("(max-width: 767px)")`,
  the same breakpoint as the layout, not a user agent.
- Check-off lives in component state and `sessionStorage`, keyed by recipe and
  cooking session. It is not a server fact.
- Timers: each step has at most one. A step with a duration shows a button that
  starts at that duration. A step without a duration shows `Timer hinzufügen`
  with an empty minutes field; there is no 5-minute default. The one-page view
  keeps its 5-minute default, because it is a manual action there.
- Starting a timer writes a row and a delayed job at
  `ends_at`. The worker sends a push at that time. The client also runs a
  local interval for the visible countdown.
  - Reload or second device: the countdown is recomputed from `ends_at`.
  - A timer fires once. The job sets `notified_at` in the same transaction.
- Servings: `fraction.js` for rational arithmetic, never floats. A unit table
  holds `round_step` and a rule per unit:
  - eggs and countable pieces: 0.5
  - grams: 5
  - millilitres: 10
  - teaspoons: 0.25
  - tablespoons: 0.5
  A factor of 1.5 on 3 eggs gives 4.5 → 4 or 5 by `round_step` 0.5, shown as
  `4 ½`. Never `1 ⅓` of an egg.
- The conversion is display-only. "Übernehmen" copies the recipe into a
  variation with the scaled amounts (see §5).
- Layout: CSS grid, portrait and landscape, 320 px to 1440 px. No orientation
  lock.

**Rejected:** a native app (the web APIs cover the needs; distribution is
worse); server-driven countdown UI (network hiccups); background audio tricks.

**Risk:** iOS Safari suspends background pages. The server push is the
reliable end signal; the local timer is only for the visible case.

## 10. Search and the AI filter

**Decision:** one natural-language field. The model emits a typed filter DSL.
Code compiles it to SQL.

```json
{
  "tagsAll": ["vegetarisch"],
  "tagsAny": [],
  "categories": ["wochenende"],
  "ratings": [{ "person": "me", "min": 4 }],
  "cookedBy": ["me"],
  "owner": "friends",
  "sort": "rating_desc"
}
```

- Zod schema, strict. Unknown keys and unknown persons are rejected.
- The compiler maps each key to a parameterized SQL fragment. No string SQL
  from the model.
- The rating rule (own rating first, then the chain, never a foreign rating)
  is a SQL function from §5. The model only says *whose* rating and *which*
  minimum.
- `person` resolves to the viewer or a friend. A person outside that set is a
  validation error, not a silent empty list.
- No keyword field. No fallback list. On failure: `503 ai_unavailable` and the
  German message. An empty valid result is a result, not an error.
- The last filter is kept in the URL, so a reload and a shared tab work.

**Rejected:** SQL generation by the model; full-text fallback (the spec forbids
it); a keyword box next to the AI field (the spec forbids it).

## 11. Friends, profiles, links, comments

- Friend invite: 32 random bytes, stored as SHA-256, 7-day expiry, one use.
  QR encodes `https://rezepte.ennio.vip/f/<token>`. Both sides confirm: scan
  creates `pending`, the target confirms in the app.
- QR render: `qrcode`. QR scan: `BarcodeDetector` where present, `zxing-wasm`
  fallback for iOS Safari.
- Friendship row: canonical pair (`user_low < user_high`) with a unique index.
  No duplicate requests.
- Friend list can be hidden: `users.friend_list_visible`. The API omits the
  list, but the friend relation still grants recipe access.
- Private link: 32 random bytes in the URL, hash in the database, no expiry,
  revocable. Scope is one recipe. Login is required. The recipient gets read
  and comment, never write. `Cache-Control: private, no-store` on every
  response that depends on the token.
- Comments: plain text, no HTML, line breaks kept. One reply level in V1
  (`parent_id`). Delete is a tombstone, so replies stay readable.
- Deleted account: `users.deleted_at`; the API renders `deleted account` and
  keeps the row, so comments and variations keep their author. Variations
  survive deletion of the original; `recipes.deleted_at` on the original adds
  the marker.
- No indexing: `X-Robots-Tag: noindex, nofollow` on every response,
  `robots.txt` with `Disallow: /`, no sitemap. The auth guard is the real
  protection; the headers are the second layer.

**Risk:** a private link is a bearer capability. Treat it like a password:
hash at rest, no logging of the token, rate limit lookups.

## 12. Notifications

**Decision:** Web Push with VAPID (`web-push`), plus a notifications table.

- Push works on Android Chrome and on iOS 16.4+ **only when the PWA is
  installed on the home screen**. The UI asks for installation before it asks
  for notification permission.
- One service worker (Workbox) handles `push` and `notificationclick`. It
  caches the app shell only. No recipe data is cached (offline is out of V1).
- Bell list reads the same `notifications` rows. Push is a hint; the list is
  the record. A missed push loses nothing.
- Events: comment, reply, friend request, new variation, timer end.
- Dedupe with `dedupe_key` (for example `timer:<id>`), unique per user.
- No email. No SMTP code in Kochen.
- Permission is requested after the first useful action (first comment or
  first timer), not on load.

**Rejected:** OneSignal/Firebase (a third party and an SDK for five events);
polling only (no timer alert when the screen is off).

## 13. Print and export

**Decision:** one print route, Chromium PDF in the worker, cache in R2.

- `/rezepte/:id/drucken` is a normal route with a print stylesheet:
  A4, 18 mm margin, black text, no navigation, `break-inside: avoid` on steps,
  images optional.
- Export calls `POST /api/recipes/:id/export`. The worker renders the same
  route with Playwright (Chromium) and stores the PDF in R2 at
  `exports/<recipe>/<updated_at>.pdf`. The response is a signed URL.
- One layout, two outputs. No second PDF template to keep in sync.
- Browser print from the same route gives the user a preview.
- Export also offers Markdown (title, ingredients, steps, source) for backup.
- Baking temperature and baking time are recipe fields, not ingredients. A
  surface shows each one only when it has a value: the recipe view, the print
  route, the PDF and the Markdown file. A variation copies both fields. An old
  recipe has null and shows nothing.

**Rejected:** `@react-pdf/renderer` (a second layout, font work, drift);
client-side "Save as PDF" (not a file the app produces); WeasyPrint (a Python
runtime for one feature).

**Risk:** Chromium adds about 400 MB to the worker image. Cache and a
concurrency of 1 keep memory flat. The worker image is built once per release.

## 14. Deploy and operations

- Dokploy on Ennio (`84.247.128.111`), project `Kochen`:
  - application `web` (Swarm service), port 3000, domains
    `rezepte.ennio.vip` and `kochen.ennio.vip`;
  - application `worker`, no domain;
  - PostgreSQL service with a volume;
  - a daily backup job.
- Canonical host: `rezepte.ennio.vip`. The app answers a 301 from
  `kochen.ennio.vip` to the canonical host on every route except `/healthz`.
  One cookie, one session, one set of links.
- Use Dokploy applications, not compose with Traefik labels. Swarm services
  use the file provider and do not go stale and answer 502 after a redeploy.
  (Known issue: compose routes hold a container address.)
- R2 bucket `kochen` in EU jurisdiction with the CORS policy from
  `bun run r2:cors`. Without it, browser uploads fail on every device.
- DNS: explicit proxied A records for `rezepte.ennio.vip` and
  `kochen.ennio.vip` to `84.247.128.111`. The wildcard still points to the old
  server, so both records are required.
- One Dockerfile, two targets: `web` (Bun, small) and `worker` (Node 22 +
  ffmpeg + poppler + Chromium). Build in CI, push to a registry, Dokploy pulls.
- Environment: `DATABASE_URL`, `R2_*`, `AI_*`, `VAPID_*`,
  `APP_ORIGIN=https://rezepte.ennio.vip`, `CANONICAL_HOST=rezepte.ennio.vip`,
  `ENNIO_JWKS_URL`, `ENNIO_AUD=kochen`. Secrets stay in Dokploy. Never in the
  client bundle; only `VAPID_PUBLIC_KEY` is public.
- Allowed origins: the API accepts `https://rezepte.ennio.vip` and
  `https://kochen.ennio.vip` for CORS. The CSP `connect-src` names both, plus
  `https://api.ennio.vip` and the R2 host.
- Health: `/healthz` checks the database and returns 200. Dokploy health check
  and the existing Traefik watchdog cover the rest.
- Backups: nightly `pg_dump` to R2 (30 daily, 12 monthly), encrypted with
  `age`. Media lives in R2 with versioning on. Test a restore before launch.
- Logs: JSON via `pino`, request id, user `sub`, route, duration, error code.
  No recipe text and no private link tokens in logs.
- Errors: Sentry (EU region) or GlitchTip. Optional; logs are enough at family
  scale, but a client-side error with a stack is worth it.
- Limits and feature flags in `app_settings`, editable by the operator, so the
  §3 values change without a deploy.

**Rejected:** Kubernetes (one server); Vercel (the database and workers live on
the VPS, and the domain is already on Ennio); local media volume (backup and
restore cost).

## 15. Testing

- `core` unit tests (Vitest): unit conversion and rounding, rating chain,
  filter compiler, diff, visibility policy. These are the rules that must not
  drift.
- Import fixtures for the rules in §8: `2 Äpfel`, a source without servings,
  ingredients out of step order, `20 Minuten kühlen`, and a link page with
  JSON-LD. Each has a unit test in `packages/core/test`.
- Upload cases: multiple JPG and HEIC from desktop and iPhone, camera capture,
  the screenshot fallback, offline, a rejected type, an oversized file, and a
  bucket without CORS.
- API integration tests against real Postgres (Testcontainers or a template
  database): auth middleware, 401/403, private recipe access, private link,
  comment permissions.
- Playwright end-to-end: on a local environment with a test JWT signer. The
  real SSO is a staging smoke test (sign in, grant, open, import, cook).
- AI eval set: 20 fixtures (German, English, Italian; handwriting; two video
  platforms; one recipe page with JSON-LD, one without). Measure schema
  validity, ingredient recall, step order, German output, cost and latency.
  Run on every prompt or model change.
- Device pass: iPhone Safari (installed PWA), Android Chrome, iPad, desktop.
  Portrait and landscape. Real device for wake lock, push and camera.
- Accessibility: axe on every screen, keyboard path through cooking mode,
  contrast on the paper palette.
- The `web-playtest` and `break-ui` skills drive the manual pass.

## 16. Security and privacy

| Threat | Control |
| --- | --- |
| Stolen or forged token | Ed25519 verify, `aud` check, 5-min life, HTTPS only |
| IDOR on recipes, links, comments | One `canView` policy, tests per route, no client-side filtering |
| Private link leak | 32-byte token, hash at rest, no logs, revocable, login required |
| SSRF on link import | Scheme allowlist, private-IP DNS check, redirect and size caps |
| Malicious upload | Magic-byte check, size cap, `sharp` pixel limit, worker sandbox, no execution |
| XSS in comments or imported text | No HTML render, React escaping, strict CSP |
| CSRF | Bearer token, not cookies, for Kochen writes; platform writes stay on the platform |
| Prompt injection | Data fence, no tools, strict output schema, user confirmation |
| AI cost abuse | Per-user and per-IP rate limits, hard monthly cap in the provider |
| Secret leak | Dokploy env, no secrets in the bundle or logs |
| Data loss | Nightly dumps to R2, versioning, restore drill |
| Indexing | `noindex` header, `robots.txt`, auth on every route |

Privacy (DSGVO):

- Data in the EU: Hetzner (Ennio VPS), R2 EU jurisdiction, AI provider with an
  EU region and a data processing agreement.
- Send the minimum to the model: the recipe source, not the user's profile.
- Provider retention off, training off. Confirm in the contract.
- Account deletion: a tombstone keeps authorship ("deleted account") and
  removes personal fields. Export on request as JSON.
- No analytics by default. If needed, self-hosted, cookie-free, EU.

## 17. Decision table

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | One set of models, one test suite |
| Web runtime | Bun + Hono | Platform stack, one process for SPA and API |
| Worker runtime | Node 22 | Playwright, sharp, ffmpeg are Node-first |
| UI | React 19 + Vite + TanStack Query + Tailwind | SPA fits an app behind a login |
| Data | Postgres 17 + Drizzle + SQL | Chains, ratings, grants; recursive CTE |
| Media | R2 + sharp/ffmpeg | Direct upload, signed URLs, cheap storage |
| Auth | ennio.vip session + 5-min JWT | Requirement; no second account system |
| AI | Hosted Gemini Flash class + ASR | No GPU, handwriting, video, German |
| Queue | Postgres jobs, `SKIP LOCKED` | No Redis, one backup, good at this size |
| Push | Web Push + VAPID | No third party; works on installed iOS PWA |
| Print/export | Print route + Chromium PDF | One layout, real file |
| Deploy | Dokploy Swarm apps | Avoids stale Traefik routes, known 502 |
| Tests | Vitest + Playwright + AI evals | Rules, flows, model drift |

## 18. Open questions

1. Who registers the project `kochen` on `ennio.vip`, and who is the operator
   for grants?
2. "Only German is stored" vs "raw text and original stay available": keep the
   original language as an artifact and the German as the canonical recipe?
   This document assumes yes.
3. Shopping list: "the user's own variation" — the latest variation by that
   user in the chain, or a chosen one? Assume the latest.
4. Instagram and TikTok may refuse server access. Is the screenshot fallback
   acceptable for those two sources from day one?
5. "Original and variation side by side": against the current predecessor or
   the snapshot? Assume current, with a drift note.
6. Export format: PDF only, or PDF plus Markdown/JSON?
7. Do we keep original media forever, or add an operator-set retention?
8. Does account deletion start on `ennio.vip` or inside Kochen? The tombstone
   works for both; the trigger needs a decision.
9. Can several timers run at once (one per step), or only one at a time?
   Assume several, one per step.
10. Are comments one reply level or unlimited nesting? Assume one in V1.
