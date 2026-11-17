import Link from "next/link";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** The plain page used for Terms and Privacy. */
export function Legal({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-[760px] items-center px-4 sm:px-6">
        <Logo />
        <span className="ms-auto flex items-center gap-2">
          <Link href="/" className="text-[14.5px] text-ink-2 hover:text-ink">
            Home
          </Link>
          <ThemeToggle />
        </span>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-4 pt-6 pb-20 sm:px-6">
        <h1 className="font-display text-[34px]">{title}</h1>
        <p className="mt-1.5 text-[14px] text-muted">Last updated {updated}</p>
        <div className="mt-8 space-y-6 text-[15.5px] leading-relaxed text-ink-2 [&_h2]:mb-1.5 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-ink">{children}</div>
      </main>
    </>
  );
}
