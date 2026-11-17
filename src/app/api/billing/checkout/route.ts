import { NextResponse } from "next/server";

import { accountOf } from "@/lib/server/account";
import { hit } from "@/lib/server/auth-helpers";
import { createCheckout, paymentsEnabled } from "@/lib/server/billing";
import { fail } from "@/lib/server/http";
import { currentUser } from "@/lib/server/session";

// Starts a payment: answers with the checkout page's address, and the browser goes there.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown };
  const kind = body.kind === "storage" ? "storage" : "pro";
  if (!paymentsEnabled(kind)) return fail(503, "Payments aren't switched on yet. Email me@dealwithmuhammad.com and I'll set you up.");
  const account = await accountOf(user);
  if (kind === "pro" && account.plan === "pro") return fail(409, "You're already on Pro.");
  if (kind === "storage" && account.plan !== "pro") return fail(409, "Extra storage is an add-on for Pro. Upgrade first.");
  if ((await hit(`clip:checkout:${user.id}`, 600)) > 10) return fail(429, "Too many tries. Wait a few minutes.");
  try {
    return NextResponse.json({ url: await createCheckout({ kind, userId: user.id, email: user.email }) });
  } catch (e) {
    console.error("checkout", e);
    return fail(502, "Couldn't open the payment page. Please try again.");
  }
}
