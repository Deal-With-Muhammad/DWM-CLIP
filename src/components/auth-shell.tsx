import { Check } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const POINTS = ["Paste a YouTube, Twitch or Kick link", "Get vertical clips with captions, a hook and hashtags", "Edit any clip after it's made"];

/** The page around the sign-in and sign-up forms: the form on the left, what you get on the right. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <main className="flex min-h-dvh flex-col bg-surface px-5 py-5 sm:px-10 sm:py-6">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="rise w-full max-w-[400px]">{children}</div>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-[13px] text-muted lg:justify-start">
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

      <aside className="hidden flex-col justify-center bg-tile-violet px-12 text-white lg:flex" aria-hidden>
        <p className="max-w-[420px] font-display text-[34px] leading-[1.1]">Long video in. Clips ready to post out.</p>
        <ul className="mt-7 space-y-3.5 text-[16px]">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white text-[#3a1fa8]">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-10 flex gap-3">
          {[
            ["bg-tile-pink", "HE DIDN'T SEE IT"],
            ["bg-tile-sky", "1 VS 3"],
            ["bg-tile-pink", "WAIT FOR IT"],
          ].map(([tile, hook], i) => (
            <div key={i} className={`relative aspect-[9/16] w-[104px] overflow-hidden rounded-xl border-2 border-white/25 ${tile}`}>
              <span className="absolute inset-x-0 top-[22%] mx-auto w-fit rounded bg-white px-1.5 py-0.5 text-[8px] font-extrabold text-[#17122b]">{hook}</span>
              <span className="absolute inset-x-0 bottom-[24%] text-center text-[11px] font-extrabold text-white" style={{ textShadow: "0 1px 0 #17122b" }}>
                NO <span style={{ color: "#fff000" }}>WAY</span>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
