import { NextResponse } from "next/server";

import { EMAIL_RE, hit, logAdmin, safeNext } from "@/lib/server/auth-helpers";
import { clientIp } from "@/lib/server/http";
import { checkCode, isAdminEmail, startSession } from "@/lib/server/session";

// Step 2 of signing in: check the emailed code and start the session (cookie).
export async function POST(req: Request) {
  let body: { email?: unknown; code?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the code from the email." }, { status: 400 });
  // Guessing codes: a handful of tries per address, then wait.
  if ((await hit(`clip:verify:${email}`, 600)) > 10) return NextResponse.json({ error: "Too many tries. Ask for a new code in a few minutes." }, { status: 429 });

  if (!(await checkCode(email, { code }))) return NextResponse.json({ error: "That code isn't right or has expired. Ask for a new one." }, { status: 400 });
  await startSession(email);
  if (isAdminEmail(email)) await logAdmin(email, "sign-in", "email code", clientIp(req.headers));
  return NextResponse.json({ ok: true, next: safeNext(body.next) });
}
