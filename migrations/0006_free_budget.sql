-- A ceiling on what the clip engine may cost (see src/lib/server/budget.ts). Every video's container time is
-- added to a small ledger when it ends, so the total survives a member deleting the video.

-- The plan a video was started on: 'free', 'lite', 'pro', or 'hours' for one paid for with bought hours.
alter table jobs add column plan text not null default '';
-- 1 once the video's container time is in the ledger.
alter table jobs add column billed integer not null default 0;
update jobs set billed = 1 where status in ('done', 'error');

-- Container minutes by UTC day, split into Free videos and everything paid for.
create table spend (
  day text primary key,
  free_minutes real not null default 0,
  paid_minutes real not null default 0
);
-- 18-20 Nov 2026 from Cloudflare's own bill ($11.04, $26.20, $19.41), at the 0.6 cents a minute used from here on.
insert into spend (day, free_minutes) values ('2026-11-18', 1840), ('2026-11-19', 4367), ('2026-11-20', 3235);
-- After that, from the videos themselves.
insert into spend (day, free_minutes)
  select substr(created_at, 1, 10), coalesce(sum((julianday(coalesce(finished_at, updated_at)) - julianday(created_at)) * 1440), 0)
  from jobs where status in ('done', 'error') and created_at >= '2026-11-21' group by 1;
