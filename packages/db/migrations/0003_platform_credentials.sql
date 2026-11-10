-- Login data for platforms that block the server. One row per platform.
-- Secrets are sealed with AES-256-GCM before they reach this table.
create table if not exists platform_credentials (
  platform text primary key check (platform in ('youtube', 'instagram', 'tiktok')),
  username text,
  password_enc text,
  cookies_enc text,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);
