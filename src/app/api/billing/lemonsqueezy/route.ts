import { NextResponse } from "next/server";

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
  if (order) return hoursOrder(order);
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
