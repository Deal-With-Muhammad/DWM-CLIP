import Link from "next/link";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import type { PlanId } from "@/lib/plans";

import { SignOut } from "./sign-out";

const CHIP: Record<PlanId, string> = { free: "bg-subtle text-ink-2", lite: "bg-violet-soft text-violet", pro: "bg-brand text-white" };

/** The bar across the signed-in pages. */
export function AppHeader({ email, plan, planName, admin }: { email: string; plan: PlanId; planName: string; admin: boolean }) {
  return (
    <header className="sticky top-0 z-30 bg-canvas">
      <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center gap-3 px-4 sm:px-6">
        <Logo href="/app" />
        <Link href="/app/settings#plan" className={`rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${CHIP[plan]}`}>
          {planName}
        </Link>
        <nav className="ms-auto flex items-center gap-0.5 text-[14px]">
          <Link href="/app" className="rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-subtle">
            Clips
          </Link>
          <Link href="/app/settings" className="rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-subtle">
            Settings
          </Link>
          {admin && (
            <Link href="/admin" className="rounded-lg px-2.5 py-1.5 text-ink-2 hover:bg-subtle">
              Admin
            </Link>
          )}
          <ThemeToggle />
          <SignOut email={email} />
        </nav>
      </div>
    </header>
  );
}
