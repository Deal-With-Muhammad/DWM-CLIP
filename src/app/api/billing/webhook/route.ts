import { NextResponse } from "next/server";

import { parseSubscription, verifySignature } from "@/lib/server/billing";
import { batch, first, nowIso, run, stmt } from "@/lib/server/db";

// Paddle calls this whenever a subscription starts, renews, changes, is cancelled or ends.
// The rows it keeps are what give a member Pro and extra storage (see lib/server/account.ts).
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("paddle-signature"))) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const s = parseSubscription(payload);
  if (!s) return NextResponse.json({ ok: true, ignored: true }); // transactions, customers: nothing to do
  const at = nowIso();

  // The member's id travels with the checkout. Later events for the same subscription may not carry it, so fall back to what's stored.
  let userId = s.userId && (await first("select id from users where id = ?", s.userId)) ? s.userId : null;
  if (!userId) userId = (await first<{ user_id: string }>("select user_id from subscriptions where id like ? limit 1", `${s.id}:%`))?.user_id ?? null;
  const ours = s.items.filter((i) => i.kind);
  if (!userId || ours.length === 0) {
    await run("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, userId, `not matched: subscription ${s.id}`);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  // One row per thing subscribed to. Anything no longer on the subscription is removed.
  await batch([
    stmt("delete from subscriptions where id like ?", `${s.id}:%`),
    ...ours.map((i) =>
      stmt(
        "insert into subscriptions (id, user_id, kind, quantity, status, renews_at, ends_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        `${s.id}:${i.priceId}`,
        userId,
        i.kind,
        i.quantity,
        s.status,
        s.renewsAt,
        s.endsAt,
        at,
      ),
    ),
    stmt("insert into billing_events (at, event, user_id, detail) values (?, ?, ?, ?)", at, s.event, userId, `${ours.map((i) => `${i.kind} x${i.quantity}`).join(", ")}: ${s.status}${s.endsAt ? `, ends ${s.endsAt.slice(0, 10)}` : ""}`),
  ]);
  return NextResponse.json({ ok: true });
}
