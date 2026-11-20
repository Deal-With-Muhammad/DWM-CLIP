-- Video hours bought once (Lemon Squeezy orders). A member spends them on videos longer than their plan
-- takes, or when the plan's videos for the month are used up. Refunded packs stop counting.
create table hour_packs (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  hours real not null,
  status text not null default 'paid',
  test_mode integer not null default 0,
  created_at text not null
);
create index hour_packs_user_idx on hour_packs (user_id);

-- Hours a video was allowed to use from the member's bought hours (0 when it came from the plan). Only the
-- length actually clipped is taken: the smaller of this and the video's length (see lib/server/account.ts).
alter table jobs add column paid_hours real not null default 0;
