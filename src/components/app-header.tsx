import Link from "next/link";

import { Logo } from "@/components/logo";

import { SignOut } from "./sign-out";

/** The bar across the signed-in pages. */
export function AppHeader({ email, plan, admin }: { email: string; plan: "free" | "pro"; admin: boolean }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-[1040px] items-center gap-3 px-4 sm:px-6">
        <Logo href="/app" />
        <span className={`rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${plan === "pro" ? "bg-brand text-white" : "bg-subtle text-ink-2"}`}>{plan === "pro" ? "Pro" : "Free"}</span>
        <nav className="ms-auto flex items-center gap-1 text-[14px]">
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
          <SignOut email={email} />
        </nav>
      </div>
    </header>
  );
}
