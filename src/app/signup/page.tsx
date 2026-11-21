import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { safeNext } from "@/lib/server/auth-helpers";
import { currentUser } from "@/lib/server/session";

import { LoginForm } from "../login/login-form";

export const metadata = { title: "Sign up", description: "Create a DWM Clip account and make your first clips.", alternates: { canonical: "/signup" } };

// Signing up and signing in work the same way (a code sent by email); only the words differ.
// Someone who signs up with an address that already has an account is simply signed in.
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(one(q.next));
  if (await currentUser().catch(() => null)) redirect(next);
  return (
    <AuthShell>
      <LoginForm mode="signup" next={next} reauth={false} linkFailed={false} />
    </AuthShell>
  );
}
