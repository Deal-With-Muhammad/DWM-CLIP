import { NextResponse } from "next/server";

import { EMAIL_RE, hit, logAdmin, safeNext } from "@/lib/server/auth-helpers";
import { clientIp, siteOrigin } from "@/lib/server/http";
import { checkCode, isAdminEmail, startSession } from "@/lib/server/session";

// Where the sign-in link in the email lands.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = siteOrigin(req);
  const next = safeNext(url.searchParams.get("next"));
  const failed = NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, home));

  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  const link = url.searchParams.get("token") ?? "";
  if (!EMAIL_RE.test(email) || !link) return failed;
  if ((await hit(`clip:verify:${email}`, 600)) > 10) return failed;
  if (!(await checkCode(email, { link }))) return failed;

  await startSession(email);
  if (isAdminEmail(email)) await logAdmin(email, "sign-in", "email link", clientIp(req.headers));
  return NextResponse.redirect(new URL(next, home));
}
