import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { LITE, PRO, STORAGE_PACK, formatBytes } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { all, first } from "@/lib/server/db";
import { currentUser, isAdminEmail } from "@/lib/server/session";

import { setBonus, setPlan } from "./actions";
import { DeleteClip } from "./delete-clip";
import { When } from "./when";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Day = { day: string; n: number };

const DAYS = 14;
/** Videos on one page of the list. */
const PER_PAGE = 20;

/** The last 14 days, oldest first, with 0 for days nothing happened. */
function fill(rows: Day[]) {
  const by = new Map(rows.map((r) => [r.day, r.n]));
  return Array.from({ length: DAYS }, (_, i) => {
    const day = new Date(Date.now() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, n: by.get(day) ?? 0 };
  });
}

/** The time this many days ago, as the database stores it. */
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ page?: string; ai?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdminEmail(user.email)) notFound();

  const query = await searchParams;
  const asked = Math.max(1, Math.floor(Number(query.page)) || 1);
  const since = ago(DAYS);
  const week = ago(7);
  const now = ago(0);
  const [account, totals, subs, signups, clipDays, jobDays, users, jobs, events] = await Promise.all([
    accountOf(user),
    first<{ users: number; users7: number; jobs: number; failed: number; clips: number; bytes: number; keys: number; active7: number; done: number; aiOk: number }>(
      `select (select count(*) from users) as users, (select count(*) from users where created_at > ?1) as users7,
        (select count(*) from jobs) as jobs, (select count(*) from jobs where status = 'error') as failed,
        (select coalesce(sum(clips), 0) from usage) as clips, (select coalesce(sum(bytes), 0) from clips) as bytes,
        (select count(*) from ai_keys) as keys,
        (select count(distinct user_id) from jobs where created_at > ?1) as active7,
        (select count(*) from jobs where status = 'done') as done, (select count(*) from jobs where status = 'done' and tokens > 0) as aiOk`,
      week,
    ),
    all<{ kind: string; n: number }>(
      "select kind, coalesce(sum(quantity), 0) as n from subscriptions where status in ('active', 'trialing', 'on_trial', 'past_due') or (status = 'cancelled' and ends_at > ?) group by kind",
      now,
    ),
    all<Day>("select substr(created_at, 1, 10) as day, count(*) as n from users where created_at > ? group by day", since),
    all<Day>("select substr(created_at, 1, 10) as day, count(*) as n from clips where created_at > ? group by day", since),
    all<Day>("select substr(created_at, 1, 10) as day, count(*) as n from jobs where created_at > ? group by day", since),
    all<{ id: string; email: string; created_at: string; plan_override: string | null; bonus_bytes: number; pro: number; lite: number; clips: number; bytes: number; jobs: number }>(
      `select u.id, u.email, u.created_at, u.plan_override, u.bonus_bytes,
        (select count(*) from subscriptions s where s.user_id = u.id and s.kind = 'pro' and (s.status in ('active', 'trialing', 'on_trial', 'past_due') or (s.status = 'cancelled' and s.ends_at > ?1))) as pro,
        (select count(*) from subscriptions s where s.user_id = u.id and s.kind = 'lite' and (s.status in ('active', 'trialing', 'on_trial', 'past_due') or (s.status = 'cancelled' and s.ends_at > ?1))) as lite,
        (select coalesce(sum(clips), 0) from usage g where g.user_id = u.id) as clips,
        (select coalesce(sum(bytes), 0) from clips c where c.user_id = u.id) as bytes,
        (select count(*) from jobs j where j.user_id = u.id) as jobs
       from users u order by u.created_at desc limit 100`,
      now,
    ),
    all<{ id: string; email: string; title: string; url: string; status: string; error: string | null; note: string | null; ai_mode: string; found: number; created_at: string }>(
      "select j.id, u.email, j.title, j.url, j.status, j.error, j.note, j.ai_mode, j.found, j.created_at from jobs j join users u on u.id = j.user_id order by j.created_at desc limit ? offset ?",
      PER_PAGE,
      (asked - 1) * PER_PAGE,
    ),
    all<{ at: string; event: string; detail: string; email: string | null }>("select b.at, b.event, b.detail, u.email from billing_events b left join users u on u.id = b.user_id order by b.id desc limit 15"),
  ]);
  const t = totals!;
  const pages = Math.max(1, Math.ceil(t.jobs / PER_PAGE));
  // A page past the end (a clip list that shrank, a mistyped address) goes to the last one.
  if (asked > pages) redirect(`/admin?page=${pages}#videos`);
  const page = asked;
  // The clips of the videos on this page, to watch or remove.
  const clips = jobs.length
    ? await all<{ id: string; job_id: string; title: string; start_s: number; end_s: number; bytes: number; cover_key: string | null; version: number }>(
        `select id, job_id, title, start_s, end_s, bytes, cover_key, version from clips where job_id in (${jobs.map(() => "?").join(", ")}) order by n`,
        ...jobs.map((j) => j.id),
      )
    : [];
  const proCount = subs.find((s) => s.kind === "pro")?.n ?? 0;
  const packs = subs.find((s) => s.kind === "storage")?.n ?? 0;
  const liteCount = subs.find((s) => s.kind === "lite")?.n ?? 0;
  const mrr = proCount * PRO.price + liteCount * LITE.price + packs * STORAGE_PACK.price;

  return (
    <>
      <AppHeader email={user.email} plan={account.plan} planName={account.planName} admin />
      <main className="mx-auto w-full max-w-[1040px] px-4 pb-20 sm:px-6">
        <h1 className="mt-8 font-display text-[28px]">Admin</h1>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Members" value={t.users} sub={`${t.users7} new this week`} />
          <Tile label="Paying members" value={proCount + liteCount} sub={`$${mrr}/month: ${proCount} Pro, ${liteCount} Lite, ${packs} storage`} />
          <Tile label="Active this week" value={t.active7} sub="members who clipped a video" />
          <Tile label="Clips made" value={t.clips} sub={`${t.jobs} video${t.jobs === 1 ? "" : "s"}, ${t.failed} failed`} />
          <Tile label="Storage in use" value={formatBytes(t.bytes)} sub={`about $${((t.bytes / 1024 ** 3) * 0.015).toFixed(2)}/month on R2`} />
          <Tile label="Members with an AI key" value={`${t.keys} of ${t.users}`} sub="every plan clips with the member's own key" />
          <Tile label="AI picked the moments" value={`${t.aiOk} of ${t.done}`} sub="finished videos; the rest fell back to the loudest moments" />
        </section>

        <section className="mt-4 grid gap-3 lg:grid-cols-3">
          <Chart title="New members" days={fill(signups)} />
          <Chart title="Videos clipped" days={fill(jobDays)} />
          <Chart title="Clips made" days={fill(clipDays)} />
        </section>

        <h2 className="mt-10 font-display text-[20px]">Members</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-start text-[13.5px]">
            <thead className="text-muted">
              <tr>
                {["Email", "Joined", "Plan", "Videos", "Clips", "Storage", "Change"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const plan = u.pro ? "Pro (paid)" : u.lite ? "Lite (paid)" : u.plan_override === "pro" ? "Pro (given)" : "Free";
                return (
                  <tr key={u.id} className="odd:bg-canvas">
                    <td className="max-w-[220px] truncate px-4 py-2.5">{u.email}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                      <When iso={u.created_at} />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{plan}</td>
                    <td className="px-4 py-2.5 tabular-nums">{u.jobs}</td>
                    <td className="px-4 py-2.5 tabular-nums">{u.clips}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {formatBytes(u.bytes)}
                      {u.bonus_bytes > 0 && <span className="text-muted"> (+{formatBytes(u.bonus_bytes)})</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1.5">
                        {!u.pro && !u.lite && (
                          <form action={setPlan}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="plan" value={u.plan_override === "pro" ? "" : "pro"} />
                            <button className="rounded-lg bg-subtle px-2.5 py-1 whitespace-nowrap hover:bg-line">{u.plan_override === "pro" ? "Take Pro away" : "Give Pro"}</button>
                          </form>
                        )}
                        <form action={setBonus}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="gb" value={u.bonus_bytes > 0 ? "0" : "10"} />
                          <button className="rounded-lg bg-subtle px-2.5 py-1 whitespace-nowrap hover:bg-line">{u.bonus_bytes > 0 ? "Remove extra GB" : "+10 GB"}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div id="videos" className="mt-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 scroll-mt-20">
          <h2 className="font-display text-[20px]">Videos</h2>
          <p className="text-[13.5px] text-muted">
            {t.jobs} in all, newest first{pages > 1 && ` · page ${page} of ${pages}`}
          </p>
        </div>
        <div className="card mt-3 overflow-hidden">
          {jobs.length === 0 && <p className="px-4 py-6 text-[14px] text-muted">No videos yet.</p>}
          {jobs.map((j) => {
            const made = clips.filter((c) => c.job_id === j.id);
            return (
              <div key={j.id} className="px-4 py-3 text-[13.5px] even:bg-canvas">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className={`rounded-md px-1.5 py-0.5 text-[12px] font-medium ${j.status === "error" ? "bg-danger-soft text-danger" : j.status === "done" ? "bg-sky-soft text-sky" : "bg-warn-soft text-warn-ink"}`}>{j.status}</span>
                  <a href={j.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                    {j.title || j.url}
                  </a>
                  <span className="text-muted">
                    {j.email} · <When iso={j.created_at} />
                  </span>
                </div>
                {j.error && <p className="mt-1 text-danger">{j.error}</p>}
                {j.note && <p className={`mt-1 ${j.note.startsWith("The AI") ? "text-warn-ink" : "text-muted"}`}>{j.note}</p>}
                {made.length > 0 && (
                  <ul className="mt-2 grid gap-1.5">
                    {made.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {c.cover_key ? <img src={`/api/clips/${c.id}/file?part=cover&v=${c.version}`} alt="" loading="lazy" className="h-14 w-8 shrink-0 rounded-md bg-subtle object-cover" /> : <span className="h-14 w-8 shrink-0 rounded-md bg-subtle" />}
                        <span className="min-w-0 flex-1 truncate">{c.title || "Untitled clip"}</span>
                        <span className="whitespace-nowrap text-muted tabular-nums">
                          {Math.round(c.end_s - c.start_s)} sec · {formatBytes(c.bytes)}
                        </span>
                        <a href={`/api/clips/${c.id}/file?v=${c.version}`} target="_blank" rel="noreferrer" className="rounded-lg bg-subtle px-2.5 py-1 whitespace-nowrap hover:bg-line">
                          Watch
                        </a>
                        <DeleteClip id={c.id} />
                      </li>
                    ))}
                  </ul>
                )}
                {made.length === 0 && j.found > 0 && <p className="mt-1 text-muted">{j.found} clips made, since deleted.</p>}
              </div>
            );
          })}
        </div>
        {pages > 1 && (
          <nav className="mt-3 flex items-center justify-between text-[13.5px]" aria-label="Pages of videos">
            {page > 1 ? (
              <Link href={`/admin?page=${page - 1}#videos`} className="btn-quiet">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted tabular-nums">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={`/admin?page=${page + 1}#videos`} className="btn-quiet">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}

        <h2 className="mt-10 font-display text-[20px]">Payments</h2>
        <div className="card mt-3 overflow-hidden">
          {events.length === 0 && <p className="px-4 py-6 text-[14px] text-muted">No payment events yet.</p>}
          {events.map((e, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-[13.5px] even:bg-canvas">
              <span className="font-medium">{e.event}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{e.detail}</span>
              <span className="text-muted">
                {e.email ?? "unknown"} · <When iso={e.at} />
              </span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[26px] leading-none tabular-nums">{typeof value === "number" ? value.toLocaleString("en-US") : value}</p>
      <p className="mt-1.5 text-[12.5px] text-muted">{sub}</p>
    </div>
  );
}

/** Fourteen bars, one per day. */
function Chart({ title, days }: { title: string; days: Day[] }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  const total = days.reduce((n, d) => n + d.n, 0);
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-muted">{title}, last 14 days</p>
        <p className="text-[13px] font-semibold tabular-nums">{total}</p>
      </div>
      <div className="mt-3 flex h-20 items-end gap-1" role="img" aria-label={`${title}: ${total} in the last 14 days`}>
        {days.map((d) => (
          <div key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t-[3px] bg-brand" style={{ height: `${d.n ? Math.max(6, (d.n / max) * 100) : 2}%`, opacity: d.n ? 1 : 0.25 }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
        <span>{days[0].day.slice(5)}</span>
        <span>today</span>
      </div>
    </div>
  );
}
