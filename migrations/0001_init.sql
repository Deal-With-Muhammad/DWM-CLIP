-- DWM Clip database (Cloudflare D1, which is SQLite). Only the website can reach it.

create table users (
  id text primary key,
  email text not null unique,
  created_at text not null,
  last_sign_in_at text,
  -- Set by the admin: 'pro' gives Pro without a payment (friends, testers).
  plan_override text,
  -- Extra storage given by the admin, in bytes, on top of the plan and paid add-ons.
  bonus_bytes integer not null default 0,
  disabled integer not null default 0
);

-- One waiting sign-in per email. Only hashes are stored.
create table login_codes (
  email text primary key,
  code_hash text not null,
  link_hash text not null,
  tries integer not null default 0,
  expires_at text not null
);

create table sessions (
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at text not null
);
create index sessions_user_idx on sessions (user_id);

create table rate_limits (
  key text primary key,
  n integer not null,
  reset_at text not null
);

-- A member's own AI key (free plan). The key is stored encrypted and never sent back to the browser.
create table ai_keys (
  user_id text primary key references users (id) on delete cascade,
  provider text not null,
  model text not null,
  key_enc text not null,
  updated_at text not null
);

-- Paid subscriptions, one row per subscription at the payment provider.
create table subscriptions (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  kind text not null check (kind in ('pro', 'storage')),
  quantity integer not null default 1,
  status text not null,
  renews_at text,
  ends_at text,
  portal_url text,
  test_mode integer not null default 0,
  updated_at text not null
);
create index subscriptions_user_idx on subscriptions (user_id);

-- One pasted link.
create table jobs (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  url text not null,
  title text not null default '',
  uploader text not null default '',
  duration real not null default 0,
  game text not null default '',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  stage text not null default 'Waiting',
  progress real not null default 0,
  error text,
  note text not null default '',
  options text not null default '{}',
  -- 'ours' (Pro, our key) or 'own' (the member's key).
  ai_mode text not null,
  model text,
  tokens integer not null default 0,
  found integer not null default 0,
  failed integer not null default 0,
  created_at text not null,
  updated_at text not null,
  finished_at text
);
create index jobs_user_idx on jobs (user_id, created_at desc);
create index jobs_created_idx on jobs (created_at);

create table clips (
  id text primary key,
  job_id text not null references jobs (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  n text not null,
  title text not null default '',
  hook text not null default '',
  description text not null default '',
  hashtags text not null default '[]',
  score integer not null default 0,
  category text not null default 'other',
  start_s real not null default 0,
  end_s real not null default 0,
  bytes integer not null default 0,
  video_key text not null,
  cover_key text,
  created_at text not null,
  unique (job_id, n)
);
create index clips_user_idx on clips (user_id, created_at desc);

-- Clips made per member per month ('2026-11'). Deleting a clip frees storage but not this count.
create table usage (
  user_id text not null references users (id) on delete cascade,
  month text not null,
  clips integer not null default 0,
  primary key (user_id, month)
);

-- Every payment webhook, for the admin page and for sorting out disputes.
create table billing_events (
  id integer primary key autoincrement,
  at text not null,
  event text not null,
  user_id text,
  detail text not null default ''
);

create table admin_log (
  id integer primary key autoincrement,
  at text not null,
  email text not null,
  action text not null,
  detail text,
  ip text
);
