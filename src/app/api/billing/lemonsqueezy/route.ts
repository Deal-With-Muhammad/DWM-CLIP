import { NextResponse } from "next/server";

import { PLAN_DAYS } from "@/lib/plans";
import { first, nowIso, run } from "@/lib/server/db";
import { acceptsTestOrders, parseLemonOrder, parseLemonSubscription, verifyLemonSignature } from "@/lib/server/lemonsqueezy";

// Lemon Squeezy calls this whenever a subscription starts, renews, is cancelled or ends.
// The row it keeps is what gives a member Pro and extra storage (see lib/server/account.ts).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyLemonSignature(raw, req.headers.get("x-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const order = parseLemonOrder(payload);
  if (order) return order.plan ? planOrder(order, order.plan) : hoursOrder(order);
  const s = parseLemonSubscription(payload);
  if (!s) return NextResponse.json({ ok: true, ignored: true }); // other orders, invoices: nothing to do
  const at = nowIso();
  if (!s.kind) return NextResponse.json({ ok: true, ignored: true }); // another product in the same store
  if (s.testMode && !acceptsTestOrders()) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, s.userId, "test-mode payment ignored");
    return NextResponse.json({ ok: true, ignored: true });
  }
  // The member's id travels with the checkout. If it's missing (someone bought from a bare link), match by email.
  let userId = s.userId && (await first("select id from users where id = ?", s.userId)) ? s.userId : null;
  if (!userId && s.email) userId = (await first<{ id: string }>("select id from users where email = ?", s.email.toLowerCase()))?.id ?? null;
  if (!userId) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, null, `not matched: subscription ${s.id}, ${s.email ?? "no email"}`);
    return NextResponse.json({ ok: true, unmatched: true });
  }
  await run(
    `insert into subscriptions (id, user_id, kind, quantity, status, renews_at, ends_at, portal_url, test_mode, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (id) do update set kind = excluded.kind, quantity = excluded.quantity, status = excluded.status, renews_at = excluded.renews_at,
       ends_at = excluded.ends_at, portal_url = coalesce(excluded.portal_url, portal_url), updated_at = excluded.updated_at`,
    `ls:${s.id}`,
    userId,
    s.kind,
    s.quantity,
    s.status,
    s.renewsAt,
    s.endsAt,
    s.portal,
    s.testMode,
    at,
  );
  await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, userId, `${s.kind} x${s.quantity}: ${s.status}${s.testMode ? " (test)" : ""}`);
  return NextResponse.json({ ok: true });
}

/**
 * 30 days of Lite or Pro, paid once (order_created) or refunded (order_refunded). It is kept as a row in
 * `subscriptions` whose id begins "pass:", with the day it ends and no renewal: account.ts treats that as a plan
 * that is running until then. Buying again before it ends adds 30 days after the last one.
 */
async function planOrder(o: NonNullable<ReturnType<typeof parseLemonOrder>>, plan: "lite" | "pro") {
  const at = nowIso();
  const log = (userId: string | null, detail: string) => run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, o.event, userId, detail);
  if (o.testMode && !acceptsTestOrders()) {
    await log(o.userId, "test-mode plan order ignored");
    return NextResponse.json({ ok: true, ignored: true });
  }
  let userId = o.userId && (await first("select id from users where id = ?", o.userId)) ? o.userId : null;
  if (!userId && o.email) userId = (await first<{ id: string }>("select id from users where email = ?", o.email.toLowerCase()))?.id ?? null;
  if (!userId) {
    await log(null, `plan not matched: order ${o.id}, ${o.email ?? "no email"}, ${plan}`);
    return NextResponse.json({ ok: true, unmatched: true });
  }
  const id = `pass:ls:${o.id}`;
  const days = PLAN_DAYS * o.quantity;
  if (o.event === "order_refunded" || o.status === "refunded") {
    // The money went back: the plan stops now.
    await run("update subscriptions set status = 'refunded', ends_at = ?, updated_at = ? where id = ?", at, at, id);
    await log(userId, `${plan} for ${days} days: refunded${o.testMode ? " (test)" : ""}`);
    return NextResponse.json({ ok: true });
  }
  if (o.status !== "paid") {
    await log(userId, `${plan} for ${days} days: ${o.status}, not counted`);
    return NextResponse.json({ ok: true, ignored: true });
  }
  // The same order can be announced twice; it only counts once.
  if (await first("select id from subscriptions where id = ?", id)) return NextResponse.json({ ok: true });
  const last = await first<{ ends: string | null }>("select max(ends_at) as ends from subscriptions where user_id = ? and kind = ? and id like 'pass:%' and status = 'cancelled' and ends_at > ?", userId, plan, at);
  const from = last?.ends ? Date.parse(last.ends) : Date.parse(at);
  const ends = new Date(from + days * 86_400_000).toISOString();
  // 'cancelled' with a day it ends is how a plan that is running and won't renew is written (see account.ts).
  await run(
    "insert into subscriptions (id, user_id, kind, quantity, status, renews_at, ends_at, portal_url, test_mode, updated_at) values (?, ?, ?, 1, 'cancelled', null, ?, null, ?, ?) on conflict (id) do nothing",
    id,
    userId,
    plan,
    ends,
    o.testMode,
    at,
  );
  await log(userId, `${plan} for ${days} days: paid, until ${ends.slice(0, 10)}${o.testMode ? " (test)" : ""}`);
  return NextResponse.json({ ok: true });
}

/** A pack of video hours bought (order_created) or refunded (order_refunded). */
async function hoursOrder(o: NonNullable<ReturnType<typeof parseLemonOrder>>) {
  const at = nowIso();
  if (o.testMode && !acceptsTestOrders()) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, o.event, o.userId, "test-mode hours order ignored");
    return NextResponse.json({ ok: true, ignored: true });
  }
  let userId = o.userId && (await first("select id from users where id = ?", o.userId)) ? o.userId : null;
  if (!userId && o.email) userId = (await first<{ id: string }>("select id from users where email = ?", o.email.toLowerCase()))?.id ?? null;
  if (!userId || o.hours <= 0) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, o.event, null, `hours not matched: order ${o.id}, ${o.email ?? "no email"}, ${o.hours} h`);
    return NextResponse.json({ ok: true, unmatched: true });
  }
  const status = o.event === "order_refunded" || o.status === "refunded" ? "refunded" : o.status === "paid" ? "paid" : o.status;
  await run(
    `insert into hour_packs (id, user_id, hours, status, test_mode, created_at) values (?, ?, ?, ?, ?, ?)
     on conflict (id) do update set status = excluded.status`,
    `ls:${o.id}`,
    userId,
    o.hours,
    status,
    o.testMode,
    at,
  );
  await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, o.event, userId, `${o.hours} video hours: ${status}${o.testMode ? " (test)" : ""}`);
  return NextResponse.json({ ok: true });
}
