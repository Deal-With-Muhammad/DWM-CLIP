import Link from "next/link";

import { FREE, LITE, PRO, formatBytes, hoursLeftWord } from "@/lib/plans";
import { month } from "@/lib/server/account";
import { all, first } from "@/lib/server/db";

import { setBonus, setPlan } from "./actions";
import { When } from "./when";

// The members table on /admin, with filters (who), a search by email (q), a sort and pages (mp).
// Everything is in the address, so a filtered list can be bookmarked or refreshed.

export type MemberQuery = { who?: string; q?: string; sort?: string; mp?: string };

const PER_PAGE = 50;

/** A subscription that still counts, as in lib/server/account.ts. */
const LIVE = "(s.status in ('active', 'trialing', 'on_trial', 'past_due') or (s.status = 'cancelled' and s.ends_at > ?1))";

// One row per member with everything the filters and columns need. ?1 = now, ?2 = the first of this month.
const MEMBERS = `
  select u.id, u.email, u.created_at, u.last_sign_in_at, u.plan_override, u.bonus_bytes, u.disabled,
    exists (select 1 from subscriptions s where s.user_id = u.id and s.kind = 'pro' and ${LIVE}) as pro,
    exists (select 1 from subscriptions s where s.user_id = u.id and s.kind = 'lite' and ${LIVE}) as lite,
    (select count(*) from jobs j where j.user_id = u.id) as jobs,
    (select count(*) from jobs j where j.user_id = u.id and j.created_at >= ?2) as month_jobs,
    (select count(*) from jobs j where j.user_id = u.id and j.created_at >= ?2 and j.status != 'error' and j.paid_hours = 0) as plan_jobs,
    (select count(*) from jobs j where j.user_id = u.id and j.status = 'error') as failed,
    (select coalesce(sum(clips), 0) from usage g where g.user_id = u.id) as clips,
    (select coalesce(sum(bytes), 0) from clips c where c.user_id = u.id) as bytes,
    (select coalesce(sum(hours), 0) from hour_packs h where h.user_id = u.id and h.status = 'paid') as bought,
    (select coalesce(sum(min(paid_hours, case when duration > 0 then duration / 3600.0 else paid_hours end)), 0) from jobs j
      where j.user_id = u.id and j.paid_hours > 0 and j.status != 'error') as spent,
    exists (select 1 from ai_keys k where k.user_id = u.id) as has_key
  from users u`;

type Row = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  plan_override: string | null;
  bonus_bytes: number;
  disabled: number;
  pro: number;
  lite: number;
  jobs: number;
  month_jobs: number;
  plan_jobs: number;
  failed: number;
  clips: number;
  bytes: number;
  bought: number;
  spent: number;
  has_key: number;
  total: number;
};

// The filters: a label, and the condition on the row above.
const WHO: Record<string, { label: string; where: string }> = {
  all: { label: "Everyone", where: "1" },
  paid: { label: "Paying", where: "(pro or lite or bought > 0)" },
  pro: { label: "Pro", where: "pro" },
  lite: { label: "Lite", where: "lite and not pro" },
  hours: { label: "Bought hours", where: "bought > 0" },
  given: { label: "Given Pro", where: "plan_override is not null and not pro and not lite" },
  free: { label: "Free", where: "not pro and not lite and plan_override is null" },
  limit: { label: "Free at the limit", where: `not pro and not lite and plan_override is null and plan_jobs >= ${FREE.videos}` },
  active: { label: "Clipped this month", where: "month_jobs > 0" },
  never: { label: "Never clipped", where: "jobs = 0" },
  nokey: { label: "No AI key", where: "not has_key" },
};

const SORT: Record<string, { label: string; by: string }> = {
  new: { label: "Newest", by: "created_at desc" },
  month: { label: "Videos this month", by: "month_jobs desc, created_at desc" },
  videos: { label: "Videos in all", by: "jobs desc, created_at desc" },
  clips: { label: "Clips", by: "clips desc, created_at desc" },
  storage: { label: "Storage", by: "bytes desc" },
  seen: { label: "Last sign-in", by: "last_sign_in_at desc nulls last" },
  failed: { label: "Failed videos", by: "failed desc, created_at desc" },
};

const planOf = (u: Row) => (u.pro ? "pro" : u.lite ? "lite" : u.plan_override === "pro" ? "given" : "free");

export async function Members({ query }: { query: MemberQuery }) {
  const who = WHO[query.who ?? ""] ? query.who! : "all";
  const sort = SORT[query.sort ?? ""] ? query.sort! : "new";
  const q = (query.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.floor(Number(query.mp)) || 1);
  const now = new Date().toISOString();
  const first1 = `${month()}-01`;

  const [rows, counts] = await Promise.all([
    all<Row>(
      `with m as (${MEMBERS}) select *, count(*) over () as total from m where ${WHO[who].where} and email like ?3 escape '!'
       order by ${SORT[sort].by} limit ${PER_PAGE} offset ${(page - 1) * PER_PAGE}`,
      now,
      first1,
      `%${q.replace(/[!%_]/g, (c) => `!${c}`)}%`,
    ),
    first<Record<string, number>>(`with m as (${MEMBERS}) select ${Object.entries(WHO).map(([k, w]) => `sum(case when ${w.where} then 1 else 0 end) as "${k}"`).join(", ")} from m`, now, first1),
  ]);
  const total = rows[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (change: Partial<MemberQuery>) => {
    const next = { who, sort, q, mp: "1", ...change };
    const p = new URLSearchParams();
    if (next.who !== "all") p.set("who", next.who);
    if (next.sort !== "new") p.set("sort", next.sort);
    if (next.q) p.set("q", next.q);
    if (next.mp !== "1") p.set("mp", next.mp);
    const s = p.toString();
    return `/admin${s ? `?${s}` : ""}#members`;
  };

  return (
    <>
      <div id="members" className="mt-10 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 scroll-mt-20">
        <h2 className="font-display text-[20px]">Members</h2>
        <p className="text-[13.5px] text-muted">
          {total.toLocaleString("en-US")} {WHO[who].label.toLowerCase()}
          {q && ` matching "${q}"`}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {Object.entries(WHO).map(([k, w]) => (
          <Link
            key={k}
            href={href({ who: k })}
            aria-current={k === who ? "true" : undefined}
            className={`rounded-lg px-2.5 py-1 text-[13px] whitespace-nowrap ${k === who ? "bg-brand font-medium text-white" : "bg-subtle text-ink-2 hover:bg-line"}`}
          >
            {w.label} <span className="tabular-nums opacity-75">{(counts?.[k] ?? 0).toLocaleString("en-US")}</span>
          </Link>
        ))}
      </div>

      <form action="/admin#members" className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
        {who !== "all" && <input type="hidden" name="who" value={who} />}
        <input name="q" defaultValue={q} placeholder="Search by email" aria-label="Search by email" className="field-native !h-9 w-full max-w-[260px]" />
        <label className="flex items-center gap-2 text-muted">
          Sort by
          <select name="sort" defaultValue={sort} className="field-native !h-9 !w-auto pe-8">
            {Object.entries(SORT).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-quiet !h-9">Show</button>
        {(q || who !== "all" || sort !== "new") && (
          <Link href="/admin#members" className="text-muted underline underline-offset-4">
            Clear
          </Link>
        )}
      </form>

      <div className="card mt-3 overflow-x-auto">
        <table className="w-full min-w-[980px] text-start text-[13.5px]">
          <thead className="text-muted">
            <tr>
              {["Email", "Joined", "Last sign-in", "Plan", "This month", "Videos", "Clips", "Hours left", "Storage", "AI key", "Change"].map((h) => (
                <th key={h} className="px-3 py-2.5 text-start font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-muted">
                  Nobody here.
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const plan = planOf(u);
              const limit = plan === "pro" || plan === "given" ? PRO.videos : plan === "lite" ? LITE.videos : FREE.videos;
              const full = u.plan_jobs >= limit;
              const left = Math.max(0, u.bought - u.spent);
              return (
                <tr key={u.id} className="odd:bg-canvas">
                  <td className="max-w-[220px] truncate px-3 py-2.5" title={u.email}>
                    {u.email}
                    {u.disabled ? <span className="ms-1.5 text-danger">(blocked)</span> : null}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                    <When iso={u.created_at} />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted">{u.last_sign_in_at ? <When iso={u.last_sign_in_at} /> : "never"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[12px] font-medium ${plan === "pro" || plan === "lite" ? "bg-brand-soft text-brand-ink" : plan === "given" ? "bg-sky-soft text-sky" : "bg-subtle text-ink-2"}`}
                    >
                      {plan === "pro" ? "Pro (paid)" : plan === "lite" ? "Lite (paid)" : plan === "given" ? "Pro (given)" : "Free"}
                    </span>
                  </td>
                  <td className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${full ? "font-semibold text-warn-ink" : ""}`} title="Plan videos started this month, of the plan's limit">
                    {u.plan_jobs} / {limit}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums" title="All videos, and how many failed">
                    {u.jobs}
                    {u.failed > 0 && <span className="text-danger"> ({u.failed} failed)</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{u.clips}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{u.bought > 0 ? `${hoursLeftWord(left)} of ${u.bought}` : <span className="text-muted">none</span>}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                    {formatBytes(u.bytes)}
                    {u.bonus_bytes > 0 && <span className="text-muted"> (+{formatBytes(u.bonus_bytes)})</span>}
                  </td>
                  <td className="px-3 py-2.5">{u.has_key ? "Yes" : <span className="text-muted">No</span>}</td>
                  <td className="px-3 py-2">
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
      {pages > 1 && (
        <nav className="mt-3 flex items-center justify-between text-[13.5px]" aria-label="Pages of members">
          {page > 1 ? (
            <Link href={href({ mp: String(page - 1) })} className="btn-quiet">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted tabular-nums">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href({ mp: String(page + 1) })} className="btn-quiet">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
