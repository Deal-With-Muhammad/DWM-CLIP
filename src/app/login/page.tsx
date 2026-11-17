import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
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
    <main className="flex min-h-dvh flex-col bg-surface px-5 py-5 sm:px-10 sm:py-7">
      <Logo />
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-[400px]">
          <LoginForm next={next} reauth={reauth} linkFailed={one(q.error) === "link"} />
        </div>
      </div>
      <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-muted">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        <Link href="/#pricing" className="hover:text-ink">
          Pricing
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Terms
        </Link>
        <Link href="/refund" className="hover:text-ink">
          Refunds
        </Link>
      </nav>
    </main>
  );
}
