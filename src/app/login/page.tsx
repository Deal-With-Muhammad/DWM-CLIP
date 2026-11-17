import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { safeNext } from "@/lib/server/auth-helpers";
import { currentUser } from "@/lib/server/session";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(q.next));
  const reauth = one(q.reauth) === "1";
  if (!reauth && (await currentUser().catch(() => null))) redirect(next);
  return (
    <AuthShell>
      <LoginForm mode="signin" next={next} reauth={reauth} linkFailed={one(q.error) === "link"} />
    </AuthShell>
  );
}
