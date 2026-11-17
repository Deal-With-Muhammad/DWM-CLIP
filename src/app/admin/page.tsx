import { notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { PRO, STORAGE_PACK, formatBytes } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { all, first } from "@/lib/server/db";
import { currentUser, isAdminEmail } from "@/lib/server/session";

import { setBonus, setPlan } from "./actions";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Day = { day: string; n: number };

const DAYS = 14;

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

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdminEmail(user.email)) notFound();

  const since = ago(DAYS);
  const week = ago(7);
  const [account, totals, subs, signups, clipDays, jobDays, users, jobs, events] = await Promise.all([
    accountOf(user),
    first<{ users: number; users7: number; jobs: number; failed: number; clips: number; bytes: number; tokens: number; active7: number }>(
      `select (select count(*) from users) as users, (select count(*) from users where created_at > ?1) as users7,
        (select count(*) from jobs) as jobs, (select count(*) from jobs where status = 'error') as failed,
        (select coalesce(sum(clips), 0) from usage) as clips, (select coalesce(sum(bytes), 0) from clips) as bytes,
        (select coalesce(sum(tokens), 0) from jobs where ai_mode = 'ours') as tokens,
        (select count(distinct user_id) from jobs where created_at > ?1) as active7`,
      week,
    ),
    all<{ kind: string; n: number }>(
      "select kind, coalesce(sum(quantity), 0) as n from subscriptions where status in ('active', 'trialing', 'past_due') group by kind",
    ),
    all<Day>("select substr(created_at, 1, 10) as day, count(*) as n from users where created_at > ? group by day", since),
    all<Day>("select substr(created_at, 1, 10) as day, count(*) as n from clips where created_at > ? group by day", since),
    all<Day>("select substr(created_at, 1, 10) as day, count(*) as n from jobs where created_at > ? group by day", since),
    all<{ id: string; email: string; created_at: string; plan_override: string | null; bonus_bytes: number; pro: number; clips: number; bytes: number; jobs: number }>(
      `select u.id, u.email, u.created_at, u.plan_override, u.bonus_bytes,
        (select count(*) from subscriptions s where s.user_id = u.id and s.kind = 'pro' and s.status in ('active', 'trialing', 'past_due')) as pro,
        (select coalesce(sum(clips), 0) from usage g where g.user_id = u.id) as clips,
        (select coalesce(sum(bytes), 0) from clips c where c.user_id = u.id) as bytes,
        (select count(*) from jobs j where j.user_id = u.id) as jobs
       from users u order by u.created_at desc limit 100`,
    ),
    all<{ id: string; email: string; title: string; url: string; status: string; error: string | null; ai_mode: string; found: number; created_at: string }>(
      "select j.id, u.email, j.title, j.url, j.status, j.error, j.ai_mode, j.found, j.created_at from jobs j join users u on u.id = j.user_id order by j.created_at desc limit 25",
    ),
    all<{ at: string; event: string; detail: string; email: string | null }>("select b.at, b.event, b.detail, u.email from billing_events b left join users u on u.id = b.user_id order by b.id desc limit 15"),
  ]);
  const t = totals!;
  const proCount = subs.find((s) => s.kind === "pro")?.n ?? 0;
  const packs = subs.find((s) => s.kind === "storage")?.n ?? 0;
  const mrr = proCount * PRO.price + packs * STORAGE_PACK.price;
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <>
      <AppHeader email={user.email} plan={account.plan} admin />
      <main className="mx-auto w-full max-w-[1040px] px-4 pb-20 sm:px-6">
        <h1 className="mt-8 font-display text-[28px]">Admin</h1>

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Members" value={t.users} sub={`${t.users7} new this week`} />
          <Tile label="Paying (Pro)" value={proCount} sub={`$${mrr}/month, ${packs} storage packs`} />
          <Tile label="Active this week" value={t.active7} sub="members who clipped a video" />
          <Tile label="Clips made" value={t.clips} sub={`${t.jobs} video${t.jobs === 1 ? "" : "s"}, ${t.failed} failed`} />
          <Tile label="Storage in use" value={formatBytes(t.bytes)} sub={`about $${((t.bytes / 1024 ** 3) * 0.015).toFixed(2)}/month on R2`} />
          <Tile label="Our AI tokens" value={t.tokens.toLocaleString("en-US")} sub="used for Pro members" />
        </section>

        <section className="mt-4 grid gap-3 lg:grid-cols-3">
          <Chart title="New members" days={fill(signups)} />
          <Chart title="Videos clipped" days={fill(jobDays)} />
          <Chart title="Clips made" days={fill(clipDays)} />
        </section>

        <h2 className="mt-10 font-display text-[20px]">Members</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-start text-[13.5px]">
            <thead className="border-b border-line text-muted">
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
                const plan = u.pro ? "Pro (paid)" : u.plan_override === "pro" ? "Pro (given)" : "Free";
                return (
                  <tr key={u.id} className="border-b border-line last:border-0">
                    <td className="max-w-[220px] truncate px-4 py-2.5">{u.email}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted">{date(u.created_at)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{plan}</td>
                    <td className="px-4 py-2.5 tabular-nums">{u.jobs}</td>
                    <td className="px-4 py-2.5 tabular-nums">{u.clips}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {formatBytes(u.bytes)}
                      {u.bonus_bytes > 0 && <span className="text-muted"> (+{formatBytes(u.bonus_bytes)})</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1.5">
                        {!u.pro && (
                          <form action={setPlan}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="plan" value={u.plan_override === "pro" ? "" : "pro"} />
                            <button className="rounded-lg border border-line-strong px-2.5 py-1 whitespace-nowrap hover:bg-subtle">{u.plan_override === "pro" ? "Take Pro away" : "Give Pro"}</button>
                          </form>
                        )}
                        <form action={setBonus}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="gb" value={u.bonus_bytes > 0 ? "0" : "10"} />
                          <button className="rounded-lg border border-line-strong px-2.5 py-1 whitespace-nowrap hover:bg-subtle">{u.bonus_bytes > 0 ? "Remove extra GB" : "+10 GB"}</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="mt-10 font-display text-[20px]">Latest videos</h2>
        <div className="card mt-3 divide-y divide-line">
          {jobs.length === 0 && <p className="px-4 py-6 text-[14px] text-muted">No videos yet.</p>}
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13.5px]">
              <span className={`rounded-md px-1.5 py-0.5 text-[12px] font-medium ${j.status === "error" ? "bg-danger-soft text-danger" : j.status === "done" ? "bg-brand-soft text-brand-ink" : "bg-warn-soft text-warn-ink"}`}>{j.status}</span>
              <span className="min-w-0 flex-1 truncate">{j.title || j.url}</span>
              <span className="text-muted">
                {j.email} · {j.found} clips · {j.ai_mode === "ours" ? "our AI" : "own key"} · {date(j.created_at)}
              </span>
              {j.error && <span className="w-full truncate text-danger">{j.error}</span>}
            </div>
          ))}
        </div>

        <h2 className="mt-10 font-display text-[20px]">Payments</h2>
        <div className="card mt-3 divide-y divide-line">
          {events.length === 0 && <p className="px-4 py-6 text-[14px] text-muted">No payment events yet.</p>}
          {events.map((e, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-[13.5px]">
              <span className="font-medium">{e.event}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{e.detail}</span>
              <span className="text-muted">
                {e.email ?? "unknown"} · {date(e.at)}
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
