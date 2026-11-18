import "server-only";

import { PLANS, STORAGE_PACK, type PlanId } from "@/lib/plans";
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
};

export async function accountOf(user: User): Promise<Account> {
  const [subs, used, usage] = await Promise.all([
    all<Sub>("select id, kind, quantity, status, renews_at, ends_at, portal_url from subscriptions where user_id = ?", user.id),
    first<{ n: number }>("select coalesce(sum(bytes), 0) as n from clips where user_id = ?", user.id),
    all<{ month: string; clips: number }>("select month, clips from usage where user_id = ?", user.id),
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
  return {
    plan: id,
    planName: plan.name,
    storage: plan.storage + packs * STORAGE_PACK.bytes + (user.bonus_bytes || 0),
    used: used?.n ?? 0,
    clips: plan.clips,
    clipsMade: made,
    clipsLeft: Math.max(0, plan.clips - made),
    clipsPerVideo: plan.clipsPerVideo,
    maxHours: plan.maxHours,
    jobsAtOnce: plan.jobsAtOnce,
    quality: plan.quality,
    storagePacks: packs,
    portal: sub?.portal_url ?? active.find((s) => s.portal_url)?.portal_url ?? null,
    planEnds: sub?.ends_at ?? null,
    paysForBoth: Boolean(proSub && liteSub),
  };
}
