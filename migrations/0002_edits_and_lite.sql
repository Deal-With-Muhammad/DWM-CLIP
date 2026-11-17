-- Clips can be changed after they're made, videos can carry the member's own instructions,
-- and there is a third plan (Lite).

-- How the clip looks now, so the edit form opens with it, and whether a new version is being made.
alter table clips add column style text not null default 'bounce';
alter table clips add column layout text not null default 'crop';
alter table clips add column captions integer not null default 1;
-- The words and settings needed to make the clip again (a small JSON file in the bucket).
alter table clips add column data_key text;
alter table clips add column status text not null default 'ready';
alter table clips add column error text;
alter table clips add column edited_at text;
-- Goes up with every new version, so browsers don't show the old file.
alter table clips add column version integer not null default 1;

-- What the member asked the AI to look for.
alter table jobs add column focus text not null default '';
-- Was the streamer's webcam found? 1 yes, 0 looked and found none, null not looked for.
alter table jobs add column facecam integer;

-- Subscriptions: 'lite' is now a kind too. SQLite can't change a check, so the table is remade.
create table subscriptions_new (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  kind text not null check (kind in ('lite', 'pro', 'storage')),
  quantity integer not null default 1,
  status text not null,
  renews_at text,
  ends_at text,
  portal_url text,
  test_mode integer not null default 0,
  updated_at text not null
);
insert into subscriptions_new select id, user_id, kind, quantity, status, renews_at, ends_at, portal_url, test_mode, updated_at from subscriptions;
drop table subscriptions;
alter table subscriptions_new rename to subscriptions;
create index subscriptions_user_idx on subscriptions (user_id);
