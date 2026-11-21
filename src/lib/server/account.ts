import "server-only";

import { FREE_CLOSED, FREE_OPEN, PLANS, STORAGE_PACK, type PlanId } from "@/lib/plans";
import { closedNote, spend } from "@/lib/server/budget";
import { all, first, nowIso } from "@/lib/server/db";
import type { User } from "@/lib/server/session";

// What a member may do right now: their plan, storage and clips left. Worked out
// from the subscriptions table on every request, so a cancelled plan stops by itself.

type Sub = { id: string; kind: "lite" | "pro" | "storage"; quantity: number; status: string; renews_at: string | null; ends_at: string | null; portal_url: string | null };

/**
 * A subscription that still counts. Paddle keeps a cancelled one "active" until the time already paid
 * for runs out; Lemon Squeezy calls it "cancelled" and gives the date it ends.
 */
const live = (s: Sub, now: string) => ["active", "trialing", "on_trial", "past_due"].includes(s.status) || (s.status === "cancelled" && Boolean(s.ends_at) && s.ends_at! > now);

export const month = () => new Date().toISOString().slice(0, 7);

export type Account = {
  plan: PlanId;
  planName: string;
  /** Bytes allowed and used. */
  storage: number;
  used: number;
  /** Clips allowed this calendar month, and made so far. */
  clips: number;
  clipsMade: number;
  clipsLeft: number;
  /** Videos allowed this calendar month, started so far (errored ones don't count), and left. */
  videos: number;
  videosMade: number;
  videosLeft: number;
  /** Video hours bought, used (only the length actually clipped) and left. */
  hoursBought: number;
  hoursLeft: number;
  clipsPerVideo: number;
  maxHours: number;
  jobsAtOnce: number;
  quality: number;
  storagePacks: number;
  /** Where a Lemon Squeezy subscriber manages or cancels (Paddle has one link for everyone). */
  portal: string | null;
  /** Set when the plan is cancelled and still running: the day it stops. */
  planEnds: string | null;
  /** True when a member upgraded to Pro and is still paying for Lite too. */
  paysForBoth: boolean;
  /** Free plan only: set while the Free plan is closed, or its videos wait for the next day or billing cycle
   *  (lib/server/budget.ts). It says why; `videosLeft` is 0 meanwhile, so bought hours still work. */
  freeWaits: string | null;
};

export async function accountOf(user: User): Promise<Account> {
  const [subs, used, usage, started, hours] = await Promise.all([
    all<Sub>("select id, kind, quantity, status, renews_at, ends_at, portal_url from subscriptions where user_id = ?", user.id),
    first<{ n: number }>("select coalesce(sum(bytes), 0) as n from clips where user_id = ?", user.id),
    all<{ month: string; clips: number }>("select month, clips from usage where user_id = ?", user.id),
    first<{ n: number }>("select count(*) as n from jobs where user_id = ? and created_at >= ? and status != 'error' and paid_hours = 0", user.id, `${month()}-01`),
    first<{ bought: number; spent: number }>(
      `select (select coalesce(sum(hours), 0) from hour_packs where user_id = ?1 and status = 'paid') as bought,
        (select coalesce(sum(min(paid_hours, case when duration > 0 then duration / 3600.0 else paid_hours end)), 0) from jobs
          where user_id = ?1 and paid_hours > 0 and status != 'error') as spent`,
      user.id,
    ),
  ]);
  const now = nowIso();
  const active = subs.filter((s) => live(s, now));
  const proSub = active.find((s) => s.kind === "pro");
  const liteSub = active.find((s) => s.kind === "lite");
  const given = user.plan_override === "pro" || user.plan_override === "lite" ? user.plan_override : null;
  const id: PlanId = proSub || given === "pro" ? "pro" : liteSub || given === "lite" ? "lite" : "free";
  const plan = PLANS[id];
  const packs = id === "free" ? 0 : active.filter((s) => s.kind === "storage").reduce((n, s) => n + Math.max(1, s.quantity), 0);
  const made = usage.find((u) => u.month === month())?.clips ?? 0;
  const sub = id === "pro" ? proSub : id === "lite" ? liteSub : undefined;
  const left = Math.max(0, plan.videos - (started?.n ?? 0));
  // Free videos share a daily allowance between all members. Only looked up for a member who has a video left.
  const freeWaits = id !== "free" ? null : !FREE_OPEN ? FREE_CLOSED : left > 0 ? closedNote(await spend()) : null;
  return {
    plan: id,
    planName: plan.name,
    storage: plan.storage + packs * STORAGE_PACK.bytes + (user.bonus_bytes || 0),
    used: used?.n ?? 0,
    clips: plan.clips,
    clipsMade: made,
    clipsLeft: Math.max(0, plan.clips - made),
    videos: plan.videos,
    videosMade: started?.n ?? 0,
    videosLeft: freeWaits ? 0 : left,
    hoursBought: hours?.bought ?? 0,
    hoursLeft: Math.max(0, Math.round(((hours?.bought ?? 0) - (hours?.spent ?? 0)) * 100) / 100),
    clipsPerVideo: plan.clipsPerVideo,
    maxHours: plan.maxHours,
    jobsAtOnce: plan.jobsAtOnce,
    quality: plan.quality,
    storagePacks: packs,
    portal: sub?.portal_url ?? active.find((s) => s.portal_url)?.portal_url ?? null,
    planEnds: sub?.ends_at ?? null,
    paysForBoth: Boolean(proSub && liteSub),
    freeWaits,
  };
}
