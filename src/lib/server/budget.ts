import "server-only";

import { FREE_CLOSED, FREE_OPEN } from "@/lib/plans";
import { all, first, nowIso, run } from "@/lib/server/db";

// What the clip engine may cost. Every video runs a Cloudflare container, billed by the second, and in the first
// days almost all of them were Free videos: $56.65 in three days (18-20 Nov 2026), on the way to $500 a month.
// The owner's ceiling is about $80 a month for everything. Since 21 November 2026 the Free plan takes no new
// videos at all (FREE_OPEN in lib/plans.ts). If it is opened again, Free videos share an allowance:
//   - each UTC day, Free videos may use DAY dollars of container time between all members, then they wait for
//     the next day;
//   - once every video together (paid ones too) has used CYCLE dollars in one Cloudflare billing cycle, Free
//     videos wait for the next cycle. Paid plans and bought hours are never held back: they pay for themselves.
// $80 = $5 Workers Paid + CYCLE + what isn't counted here (clip edits, link checks, the estimate's error).

export const BUDGET = {
  /** Dollars for one minute of a video's container: $19.41 for 3,498 minutes on 20 Nov 2026, rounded up. */
  perMinute: 0.006,
  /** Dollars of Free videos in one UTC day (about 20 videos at 15 minutes each). */
  day: 1.8,
  /** Dollars of all videos in one billing cycle before Free videos wait for the next one. */
  cycle: 68,
  /** Cloudflare bills this account from the 5th of each month. */
  cycleDay: 5,
  /** The first cycle the cycle ceiling applies to. The one before it had already spent more when this was added. */
  cycleFrom: "2026-12-05",
  /** A video still running counts as at least this many minutes, so several started together can't overshoot far. */
  runningMinutes: 12,
};

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The day the current billing cycle began, and the day the next one begins. */
export function cycle(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCDate() < BUDGET.cycleDay ? 1 : 0), BUDGET.cycleDay));
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, BUDGET.cycleDay));
  return { start: dayOf(start), next: dayOf(next) };
}

export type Spend = {
  /** Dollars of Free videos today (UTC), and of every video this billing cycle. Estimates. */
  freeToday: number;
  cycleSoFar: number;
  /** Why Free videos are waiting, when they are, and the moment they open again. */
  closed: "paused" | "day" | "cycle" | null;
  opens: string | null;
};

/** How much has been spent, and whether a Free video may start now. */
export async function spend(): Promise<Spend> {
  const now = new Date();
  const at = now.toISOString();
  const { start, next } = cycle(now);
  const row = await first<{ free_done: number; cycle_done: number; free_running: number; all_running: number }>(
    `select
       coalesce((select free_minutes from spend where day = ?1), 0) as free_done,
       coalesce((select sum(free_minutes + paid_minutes) from spend where day >= ?2), 0) as cycle_done,
       coalesce((select sum(max(?4, (julianday(?3) - julianday(created_at)) * 1440)) from jobs
                  where billed = 0 and status in ('queued', 'running') and plan in ('free', '') and paid_hours = 0), 0) as free_running,
       coalesce((select sum(max(?4, (julianday(?3) - julianday(created_at)) * 1440)) from jobs
                  where billed = 0 and status in ('queued', 'running')), 0) as all_running`,
    dayOf(now),
    start,
    at,
    BUDGET.runningMinutes,
  );
  const freeToday = ((row?.free_done ?? 0) + (row?.free_running ?? 0)) * BUDGET.perMinute;
  const cycleSoFar = ((row?.cycle_done ?? 0) + (row?.all_running ?? 0)) * BUDGET.perMinute;
  const overCycle = start >= BUDGET.cycleFrom && cycleSoFar >= BUDGET.cycle;
  const closed = !FREE_OPEN ? "paused" : overCycle ? "cycle" : freeToday >= BUDGET.day ? "day" : null;
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  return { freeToday, cycleSoFar, closed, opens: closed === "cycle" ? `${next}T00:00:00.000Z` : closed === "day" ? tomorrow : null };
}

/** What a Free member is told while Free videos wait. */
export function closedNote(s: Spend): string | null {
  if (s.closed === "paused") return FREE_CLOSED;
  if (!s.closed || !s.opens) return null;
  if (s.closed === "cycle") {
    const day = new Date(s.opens).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    return `This month's free videos have all been used, by everyone together. Free clipping opens again on ${day}.`;
  }
  const hours = Math.max(1, Math.ceil((Date.parse(s.opens) - Date.now()) / 3_600_000));
  return `Today's free videos have all been used, by everyone together. Free clipping opens again in about ${hours} hour${hours === 1 ? "" : "s"}.`;
}

/**
 * Adds a video's container time to the ledger, once, when it has ended (or is being deleted while running).
 * `ended` is when it stopped; left out, that is now.
 */
export async function settle(id: string, ended?: string | null) {
  const job = await first<{ created_at: string; plan: string; paid_hours: number }>("update jobs set billed = 1 where id = ? and billed = 0 returning created_at, plan, paid_hours", id);
  if (!job) return;
  const end = ended ? Date.parse(ended) : Date.now();
  // A container stops by itself after 90 idle minutes at the very most.
  const minutes = Math.min(240, Math.max(0, (end - Date.parse(job.created_at)) / 60_000));
  const free = (job.plan === "free" || job.plan === "") && !job.paid_hours;
  await run(
    `insert into spend (day, free_minutes, paid_minutes) values (?1, ?2, ?3)
     on conflict (day) do update set free_minutes = free_minutes + excluded.free_minutes, paid_minutes = paid_minutes + excluded.paid_minutes`,
    nowIso().slice(0, 10),
    free ? minutes : 0,
    free ? 0 : minutes,
  );
}

/** Videos that ended without saying so (closed as stale, see listJobs): into the ledger. Run by the hourly timer. */
export async function settleEnded() {
  const rows = await all<{ id: string; ended: string }>("select id, coalesce(finished_at, updated_at) as ended from jobs where billed = 0 and status in ('done', 'error') limit 200");
  for (const r of rows) await settle(r.id, r.ended);
  return rows.length;
}
