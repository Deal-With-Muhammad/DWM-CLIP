import { NextResponse } from "next/server";

import { acceptsTestOrders, parseSubscription, verifySignature } from "@/lib/server/billing";
import { first, nowIso, run } from "@/lib/server/db";

// Lemon Squeezy calls this whenever a subscription starts, renews, is cancelled or ends.
// The row it keeps is what gives a member Pro and extra storage (see lib/server/account.ts).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const s = parseSubscription(payload);
  if (!s) return NextResponse.json({ ok: true, ignored: true }); // orders, invoices: nothing to do
  const at = nowIso();
  if (s.testMode && !acceptsTestOrders()) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, s.userId, "test-mode payment ignored");
    return NextResponse.json({ ok: true, ignored: true });
  }
  // The member's id travels with the checkout. If it's missing (a subscription made by hand in the dashboard), match by email.
  let userId = s.userId && (await first("select id from users where id = ?", s.userId)) ? s.userId : null;
  if (!userId && s.email) userId = (await first<{ id: string }>("select id from users where email = ?", s.email.toLowerCase()))?.id ?? null;
  if (!userId || !s.kind) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, userId, `not matched: subscription ${s.id}, ${s.email ?? "no email"}`);
    return NextResponse.json({ ok: true, unmatched: true });
  }
  await run(
    `insert into subscriptions (id, user_id, kind, quantity, status, renews_at, ends_at, portal_url, test_mode, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (id) do update set kind = excluded.kind, quantity = excluded.quantity, status = excluded.status, renews_at = excluded.renews_at,
       ends_at = excluded.ends_at, portal_url = coalesce(excluded.portal_url, portal_url), updated_at = excluded.updated_at`,
    s.id,
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
