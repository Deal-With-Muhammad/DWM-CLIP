import { NextResponse } from "next/server";

import { EMAIL_RE, hits, safeNext } from "@/lib/server/auth-helpers";
import { clientIp, siteOrigin } from "@/lib/server/http";
import { sendCode } from "@/lib/server/mail";
import { issueCode } from "@/lib/server/session";

// Step 1 of signing in: email a 6-digit code (and a sign-in link) to this address.
// New addresses get an account the first time they sign in.
export async function POST(req: Request) {
  let body: { email?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });

  const [byIp, byEmail] = await hits([
    [`clip:otp:ip:${clientIp(req.headers)}`, 600],
    [`clip:otp:email:${email}`, 600],
  ]);
  if (byIp > 8 || byEmail > 4) return NextResponse.json({ error: "Too many codes asked for. Wait a few minutes and try again." }, { status: 429 });

  const next = safeNext(body.next);
  try {
    const { code, link } = await issueCode(email);
    await sendCode(email, code, `${siteOrigin(req)}/auth/confirm?email=${encodeURIComponent(email)}&token=${link}&next=${encodeURIComponent(next)}`);
  } catch (e) {
    console.error("sign-in email", e);
    return NextResponse.json({ error: "Couldn't send the code. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
