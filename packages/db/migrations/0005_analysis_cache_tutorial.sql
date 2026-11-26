-- Kochen — analysed-link cache and tutorial state.

-- ---------------------------------------------------------------------------
-- One row per analysed source link. The worker reads this before any fetch or
-- model call, so a link that was understood once is never understood again.
-- The key is a canonical URL (see packages/core/src/source-cache.ts).
-- ---------------------------------------------------------------------------
create table import_analysis_cache (
  url_key text primary key check (length(url_key) between 1 and 1200),
  source_url text not null,
  version integer not null default 1,
  draft jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  asks_for_screenshot boolean not null default false,
  servings_estimated boolean not null default false,
  source_lang text,
  signals jsonb not null default '[]'::jsonb,
  caption_weak boolean not null default false,
  raw_text text,
  transcript text,
  hits integer not null default 0 check (hits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index import_analysis_cache_created_idx on import_analysis_cache (created_at desc);

create trigger import_analysis_cache_updated_at before update on import_analysis_cache
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- The tour runs once per account. The timestamp stays null until the person
-- steps through it or skips it.
-- ---------------------------------------------------------------------------
alter table users add column tutorial_done_at timestamptz;
