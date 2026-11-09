-- Kochen — initial schema. Postgres 17.
-- Rules live here, not only in application code.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  platform_sub text not null unique,
  email text,
  name text not null default '',
  role text not null default 'member' check (role in ('member', 'admin', 'owner')),
  avatar_url text,
  friend_list_visible boolean not null default true,
  cooking_view text not null default 'steps' check (cooking_view in ('steps', 'overview')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Units (seeded below). Keys match the contracts package.
-- ---------------------------------------------------------------------------
create table units (
  key text primary key,
  label text not null,
  plural text not null,
  dimension text not null check (dimension in ('mass', 'volume', 'count', 'time')),
  factor numeric not null,
  round_step numeric not null,
  merge_group text not null
);

insert into units (key, label, plural, dimension, factor, round_step, merge_group) values
  ('g',       'g',       'g',        'mass',   1,    5,    'mass'),
  ('kg',      'kg',      'kg',       'mass',   1000, 0.05, 'mass'),
  ('ml',      'ml',      'ml',       'volume', 1,    10,   'volume'),
  ('l',       'l',       'l',        'volume', 1000, 0.05, 'volume'),
  ('tl',      'TL',      'TL',       'volume', 5,    0.25, 'teaspoon'),
  ('el',      'EL',      'EL',       'volume', 15,   0.5,  'tablespoon'),
  ('stueck',  'Stück',   'Stück',    'count',  1,    0.5,  'count'),
  ('prise',   'Prise',   'Prisen',   'count',  1,    0.5,  'pinch'),
  ('bund',    'Bund',    'Bund',     'count',  1,    0.5,  'bunch'),
  ('dose',    'Dose',    'Dosen',    'count',  1,    0.5,  'can'),
  ('packung', 'Packung', 'Packungen','count',  1,    0.5,  'pack'),
  ('zehe',    'Zehe',    'Zehen',    'count',  1,    0.25, 'clove'),
  ('scheibe', 'Scheibe', 'Scheiben', 'count',  1,    0.5,  'slice'),
  ('tasse',   'Tasse',   'Tassen',   'volume', 200,  0.25, 'cup'),
  ('min',     'Min.',    'Min.',     'time',   60,   1,    'time');

-- ---------------------------------------------------------------------------
-- Recipes and their lines
-- ---------------------------------------------------------------------------
create table recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text,
  servings integer not null default 4 check (servings between 1 and 100),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'photo', 'link', 'video', 'text', 'pdf')),
  source_url text,
  raw_text text,
  transcript text,
  original_lang text,
  visibility text not null default 'friends' check (visibility in ('private', 'friends', 'members')),
  parent_id uuid references recipes(id),
  root_id uuid,
  depth integer not null default 0,
  forked_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_owner_idx on recipes (owner_id, updated_at desc);
create index recipes_parent_idx on recipes (parent_id);
create index recipes_root_idx on recipes (root_id);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  amount numeric(12,3) check (amount is null or amount > 0),
  unit_key text references units(key),
  name text not null check (length(btrim(name)) between 1 and 200),
  note text check (note is null or length(note) <= 300),
  lineage_key uuid not null default gen_random_uuid()
);
create index recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id, position);
create unique index recipe_ingredients_lineage_idx on recipe_ingredients (recipe_id, lineage_key);

create table recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position integer not null check (position >= 0),
  text text not null check (length(btrim(text)) between 1 and 4000),
  duration_s integer check (duration_s is null or duration_s > 0),
  lineage_key uuid not null default gen_random_uuid()
);
create index recipe_steps_recipe_idx on recipe_steps (recipe_id, position);
create unique index recipe_steps_lineage_idx on recipe_steps (recipe_id, lineage_key);

create table images (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  r2_key text not null,
  width integer,
  height integer,
  kind text not null default 'cover' check (kind in ('cover', 'step', 'original')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index images_recipe_idx on images (recipe_id, position);

-- ---------------------------------------------------------------------------
-- Tags and categories
-- ---------------------------------------------------------------------------
create table tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  created_at timestamptz not null default now()
);
create index tags_slug_trgm_idx on tags using gin (slug gin_trgm_ops);

create table recipe_tags (
  recipe_id uuid not null references recipes(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  confirmed_by uuid references users(id),
  primary key (recipe_id, tag_id)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index categories_owner_name_idx on categories (owner_id, lower(name));

create table recipe_categories (
  recipe_id uuid not null references recipes(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (recipe_id, category_id)
);
create index recipe_categories_category_idx on recipe_categories (category_id);

-- ---------------------------------------------------------------------------
-- Cooking, ratings
-- ---------------------------------------------------------------------------
create table cook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  recipe_id uuid not null references recipes(id),
  cooked_at timestamptz not null default now()
);
create index cook_events_user_recipe_idx on cook_events (user_id, recipe_id, cooked_at desc);

create table ratings (
  user_id uuid not null references users(id),
  recipe_id uuid not null references recipes(id),
  stars numeric(2,1) not null check (stars in (0.5,1,1.5,2,2.5,3,3.5,4,4.5,5)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
create index ratings_recipe_idx on ratings (recipe_id);

create view cook_status as
select ce.user_id,
       ce.recipe_id,
       count(*)::int as count,
       max(ce.cooked_at) as last_cooked_at
from cook_events ce
group by ce.user_id, ce.recipe_id;

-- ---------------------------------------------------------------------------
-- Social
-- ---------------------------------------------------------------------------
create table comments (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  author_id uuid not null references users(id),
  parent_id uuid references comments(id),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index comments_recipe_idx on comments (recipe_id, created_at);
create index comments_parent_idx on comments (parent_id);

create table private_links (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index private_links_recipe_idx on private_links (recipe_id);

create table friendships (
  user_low uuid not null references users(id),
  user_high uuid not null references users(id),
  status text not null check (status in ('pending', 'accepted', 'denied')),
  requested_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_low, user_high),
  check (user_low < user_high)
);

create table friend_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index friend_invites_owner_idx on friend_invites (owner_id);

-- ---------------------------------------------------------------------------
-- Notifications, push, timers
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('comment','reply','friend_request','friend_accepted','variation','timer')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  dedupe_key text
);
create unique index notifications_dedupe_idx on notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on notifications (user_id, created_at desc);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  endpoint text not null unique,
  keys jsonb not null,
  ua text,
  failed_at timestamptz,
  created_at timestamptz not null default now()
);

create table timers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  recipe_id uuid not null references recipes(id),
  step_id text not null,
  ends_at timestamptz not null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index timers_pending_idx on timers (ends_at) where notified_at is null;

-- ---------------------------------------------------------------------------
-- Jobs and settings
-- ---------------------------------------------------------------------------
create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued'
    check (state in ('queued','fetching','normalizing','understanding','needs_review','done','failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_at timestamptz,
  last_error text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs (state, run_at) where state not in ('done','failed');
create index jobs_user_idx on jobs (user_id, created_at desc);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value) values
  ('limits', '{"maxVideoMinutes":20,"maxAudioMinutes":20,"maxPhotos":10,"maxPhotoMb":10,"maxTotalMb":25,"maxPdfPages":10}'::jsonb),
  ('features', '{"ai":true,"video":true}'::jsonb);

-- ---------------------------------------------------------------------------
-- Rules as functions and triggers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

create trigger users_updated_at before update on users
  for each row execute function set_updated_at();
create trigger recipes_updated_at before update on recipes
  for each row execute function set_updated_at();
create trigger jobs_updated_at before update on jobs
  for each row execute function set_updated_at();

-- Root, depth and immutable parent set at fork.
create or replace function recipe_lineage() returns trigger as $$
declare parent_depth integer;
begin
  if tg_op = 'UPDATE' and new.parent_id is distinct from old.parent_id then
    raise exception 'parent_is_immutable';
  end if;
  if new.parent_id is null then
    new.root_id := new.id;
    new.depth := 0;
  else
    select depth into parent_depth from recipes where id = new.parent_id;
    if parent_depth is null then
      raise exception 'parent_missing';
    end if;
    new.root_id := (select root_id from recipes where id = new.parent_id);
    new.depth := parent_depth + 1;
    if new.forked_at is null then
      new.forked_at := now();
    end if;
  end if;
  return new;
end $$ language plpgsql;

create trigger recipes_lineage before insert on recipes
  for each row execute function recipe_lineage();

-- A rating needs a cook event of the same person and recipe.
create or replace function rating_needs_cook() returns trigger as $$
begin
  if not exists (
    select 1 from cook_events
    where user_id = new.user_id and recipe_id = new.recipe_id
  ) then
    raise exception 'rating_requires_cook';
  end if;
  new.updated_at := now();
  return new;
end $$ language plpgsql;

create trigger ratings_need_cook before insert or update on ratings
  for each row execute function rating_needs_cook();

-- Cook events are append-only.
create or replace function reject_change() returns trigger as $$
begin
  raise exception 'append_only';
end $$ language plpgsql;

create trigger cook_events_append_only before update or delete on cook_events
  for each row execute function reject_change();

-- One reply level, same recipe.
create or replace function comment_parent_rule() returns trigger as $$
declare parent_parent uuid;
declare parent_recipe uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  select parent_id, recipe_id into parent_parent, parent_recipe from comments where id = new.parent_id;
  if parent_recipe is null then
    raise exception 'parent_missing';
  end if;
  if parent_recipe <> new.recipe_id then
    raise exception 'parent_other_recipe';
  end if;
  if parent_parent is not null then
    raise exception 'nesting_too_deep';
  end if;
  return new;
end $$ language plpgsql;

create trigger comments_parent_rule before insert on comments
  for each row execute function comment_parent_rule();

-- Rating chain rule: own rating first, then the nearest ancestor rating of that
-- person. Never reads a rating outside the chain.
create or replace function rating_chain(recipe uuid, person uuid)
returns numeric as $$
  with recursive chain(id, parent_id, depth) as (
    select r.id, r.parent_id, 0 from recipes r where r.id = recipe
    union all
    select r.id, r.parent_id, c.depth + 1
    from recipes r join chain c on r.id = c.parent_id
  )
  select ra.stars
  from chain c
  join ratings ra on ra.recipe_id = c.id and ra.user_id = person
  order by c.depth
  limit 1
$$ language sql stable;

-- Friend list lookup used by the visibility policy.
create or replace function are_friends(a uuid, b uuid)
returns boolean as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and user_low = least(a, b)
      and user_high = greatest(a, b)
  )
$$ language sql stable;
