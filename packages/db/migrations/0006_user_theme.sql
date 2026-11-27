-- A member's palette. Four colours are enough; the client derives the rest.
-- null means the default palette, so existing accounts need no backfill.
alter table users add column theme jsonb;

alter table users
  add constraint users_theme_object
  check (theme is null or jsonb_typeof(theme) = 'object');
