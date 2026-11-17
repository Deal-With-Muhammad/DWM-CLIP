import { Check } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { TryBox } from "@/components/try-box";
import { FREE, PRO, STORAGE_PACK, formatBytes } from "@/lib/plans";
import { currentUser } from "@/lib/server/session";
import { site } from "@/lib/site";

// What a finished clip looks like: the hook box on top, word-by-word captions, a score.
const SAMPLES = [
  { hook: "HE DIDN'T SEE IT", words: ["NO", "WAY", "BRO"], on: 1, score: 92, title: "The cop car came out of nowhere", bg: "#1d3a4a", cam: true },
  { hook: "1 VS 3", words: ["WATCH", "THIS"], on: 0, score: 87, title: "Clutch escape with one bar of health", bg: "#3d2b52", cam: true },
  { hook: "WAIT FOR IT", words: ["OH", "MY", "GOD"], on: 2, score: 81, title: "The jump nobody thought would land", bg: "#4a2a2a", cam: false },
];

const FAQ = [
  {
    q: "Do I need an AI key?",
    a: "On the free plan, yes: the AI that picks the moments runs on your own key. Google gives Gemini keys for free and it takes about a minute to get one. On Pro you don't need a key, our AI does it.",
  },
  {
    q: "Which videos can I clip?",
    a: "Any public YouTube, Twitch or Kick video: streams, gameplay, podcasts, interviews. Clip videos you made or have permission to use (for example a creator's clipping campaign). You're responsible for the rights to what you post.",
  },
  { q: "How long does it take?", a: "A 10-minute video takes about two minutes. An hour-long stream takes around ten. Clips appear one by one as they finish, so you can start posting before the whole video is done." },
  { q: "Is it only for GTA 6?", a: "No. It knows GTA VI and 20 other games by name, so the titles and hashtags fit the game, but it works on any video where something happens or someone talks." },
  { q: "What happens when my storage is full?", a: "New clips aren't saved until you delete some or add storage. Download the clips you want to keep, delete them here, and the space is yours again." },
  { q: "Can I cancel Pro?", a: "Yes, any time, from Settings. You keep Pro until the end of the month you paid for. If it didn't work for you, ask within 14 days of a payment and you get that payment back." },
];

export default async function Home() {
  const user = await currentUser().catch(() => null);
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-[1040px] items-center gap-2 px-4 sm:px-6">
        <Logo />
        <nav className="ms-auto flex items-center gap-1 text-[14.5px]">
          <a href="#how" className="hidden rounded-lg px-3 py-1.5 text-ink-2 hover:bg-subtle sm:block">
            How it works
          </a>
          <a href="#pricing" className="rounded-lg px-3 py-1.5 text-ink-2 hover:bg-subtle">
            Pricing
          </a>
          <Link href={user ? "/app" : "/login"} className="ms-1 inline-flex h-9 items-center rounded-xl bg-ink px-4 font-medium text-white hover:bg-ink-2">
            {user ? "Open app" : "Sign in"}
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[1040px] items-center gap-10 px-4 pt-8 pb-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
          <div>
            <h1 className="font-display text-[40px] leading-[1.05] sm:text-[52px]">Paste a link. Get clips that are ready to post.</h1>
            <p className="mt-4 max-w-[500px] text-[17px] leading-relaxed text-ink-2">
              DWM Clip watches a stream or long video for you, finds the best moments, and turns each one into a vertical clip with captions, a hook, a title and hashtags.
            </p>
            <div className="mt-7 max-w-[520px]">
              <TryBox />
              <p className="mt-2.5 text-[13.5px] text-muted">
                Free to try: {FREE.clips} clips, no card. Works with YouTube, Twitch and Kick.
              </p>
            </div>
          </div>

          <div className="flex justify-center gap-3 sm:gap-4" aria-hidden>
            {SAMPLES.map((s, i) => (
              <div key={s.hook} className={`w-[31%] max-w-[168px] ${i === 1 ? "mt-8" : ""}`}>
                <div className="relative aspect-[9/16] overflow-hidden rounded-2xl" style={{ background: s.bg }}>
                  {s.cam && <span className="absolute end-2 top-2 h-[17%] w-[36%] rounded-md border border-white/40 bg-white/15" />}
                  <span className="absolute inset-x-0 top-[24%] mx-auto w-fit max-w-[88%] rounded-md bg-white px-2 py-1 text-center text-[10px] leading-tight font-extrabold text-ink sm:text-[11.5px]">{s.hook}</span>
                  <span className="absolute inset-x-0 bottom-[26%] flex justify-center gap-1.5 text-[13px] font-extrabold text-white sm:text-[16px]" style={{ textShadow: "0 0 3px #000, 0 2px 0 #000" }}>
                    {s.words.map((w, k) => (
                      <span key={w} style={k === s.on ? { color: "#fff000" } : undefined}>
                        {w}
                      </span>
                    ))}
                  </span>
                  <span className="absolute start-2 bottom-2 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink">{s.score}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug font-medium text-ink-2">{s.title}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-[1040px] px-4 py-14 sm:px-6">
            <h2 className="font-display text-[30px]">How it works</h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-3">
              <li>
                <div className="rounded-xl border border-line bg-canvas p-3">
                  <div className="flex h-10 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] text-muted">youtube.com/watch?v=…</div>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">1. Paste the link</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">A stream VOD, a gameplay video, a podcast. Pick how many clips you want and how the captions should look.</p>
              </li>
              <li>
                <div className="rounded-xl border border-line bg-canvas p-3">
                  <div className="h-2 overflow-hidden rounded-full bg-subtle">
                    <div className="h-full w-[62%] rounded-full bg-brand" />
                  </div>
                  <p className="mt-2.5 text-[13px] text-ink-2">Finding the best moments (minute 40 of 60) · 2 ready</p>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">2. It finds the moments</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">It reads what was said, listens for the loud moments, and picks the parts a stranger would stop scrolling for. Each one gets a score.</p>
              </li>
              <li>
                <div className="rounded-xl border border-line bg-canvas p-3">
                  <p className="text-[13.5px] font-medium">The cop car came out of nowhere</p>
                  <p className="mt-1 text-[12.5px] text-brand-ink">#GTA6 #ViceCity #RockstarGames</p>
                  <div className="mt-2.5 flex gap-2 text-[12.5px]">
                    <span className="rounded-lg bg-brand px-2.5 py-1 font-medium text-white">Download</span>
                    <span className="rounded-lg border border-line-strong bg-surface px-2.5 py-1">Copy caption</span>
                  </div>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">3. Download and post</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Every clip is 9:16 with captions burned in, and comes with a title, description and hashtags to paste into TikTok, Reels or Shorts.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1040px] px-4 py-14 sm:px-6">
          <h2 className="font-display text-[30px]">Built for gameplay and streams</h2>
          <ul className="mt-7 grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {[
              ["The game fills the screen, the facecam stays", "It finds the streamer's webcam and keeps it in the corner, so viewers see the play and the reaction."],
              ["Captions word by word", "Three styles (Bounce, Hype, Clean), timed to the voice, with the word being said highlighted."],
              ["A hook on every clip", "A short line at the top, taken from what was said or what happened: \"1 VS 3\", \"HE GOT ME\"."],
              ["Titles and hashtags that fit the game", "It knows GTA VI and 20 more games by name and adds the tags people search for."],
              ["Long streams are fine", "Videos up to 3 hours on Pro. It only downloads the parts it clips, so it stays fast."],
              ["Your clips, kept for you", "Clips stay in your library until you delete them. Download any time."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <Check className="mt-1 size-[18px] shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="text-[16px] font-semibold">{t}</p>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-ink-2">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="pricing" className="scroll-mt-4 border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-[1040px] px-4 py-14 sm:px-6">
            <h2 className="font-display text-[30px]">Pricing</h2>
            <p className="mt-2 max-w-[560px] text-[16px] leading-relaxed text-ink-2">Try it free with your own AI key. Go Pro when you want more clips and don&apos;t want to think about keys.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-line p-6">
                <p className="text-[17px] font-semibold">Free</p>
                <p className="mt-1 font-display text-[36px] leading-none">$0</p>
                <ul className="mt-5 space-y-2.5 text-[15px] text-ink-2">
                  <Row>{FREE.clips} clips to try it</Row>
                  <Row>Bring your own AI key (Gemini&apos;s is free)</Row>
                  <Row>{formatBytes(FREE.storage)} of storage</Row>
                  <Row>720p, videos up to {FREE.maxHours} hour</Row>
                </ul>
                <Link href="/app" className="mt-6 inline-flex h-11 items-center rounded-xl border border-line-strong px-5 text-[15px] font-medium hover:bg-subtle">
                  Start free
                </Link>
              </div>
              <div className="rounded-2xl border-2 border-brand p-6">
                <p className="text-[17px] font-semibold">Pro</p>
                <p className="mt-1 font-display text-[36px] leading-none">
                  ${PRO.price}
                  <span className="text-[16px] font-normal text-muted"> /month</span>
                </p>
                <ul className="mt-5 space-y-2.5 text-[15px] text-ink-2">
                  <Row>{PRO.clips} clips every month</Row>
                  <Row>Our AI picks the moments, no key needed</Row>
                  <Row>
                    {formatBytes(PRO.storage)} of storage, +{formatBytes(STORAGE_PACK.bytes)} for ${STORAGE_PACK.price}/month
                  </Row>
                  <Row>
                    1080p, videos up to {PRO.maxHours} hours, {PRO.clipsPerVideo} clips per video
                  </Row>
                  <Row>Two videos at once</Row>
                </ul>
                <Link href="/app/settings#plan" className="mt-6 inline-flex h-11 items-center rounded-xl bg-brand px-5 text-[15px] font-medium text-white hover:bg-brand-ink">
                  Go Pro
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[760px] px-4 py-14 sm:px-6">
          <h2 className="font-display text-[30px]">Questions</h2>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16.5px] font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-[20px] leading-none text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1040px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-[13.5px] text-muted sm:px-6">
          <span>
            {site.name}, by{" "}
            <a href="https://www.dealwithmuhammad.com" className="underline underline-offset-4 hover:text-ink">
              Muhammad
            </a>
          </span>
          <span className="ms-auto flex gap-5">
            <a href="#pricing" className="hover:text-ink">
              Pricing
            </a>
            <Link href="/terms" className="hover:text-ink">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/refund" className="hover:text-ink">
              Refunds
            </Link>
            <a href={`mailto:${site.contact}`} className="hover:text-ink">
              Contact
            </a>
          </span>
        </div>
        <p className="mx-auto w-full max-w-[1040px] px-4 pb-6 text-[12.5px] text-muted sm:px-6">
          The clip engine is built on{" "}
          <a href="https://github.com/haziqahmedqasmi/PeakCut" className="underline underline-offset-4">
            PeakCut
          </a>{" "}
          (MIT licence). Not affiliated with Rockstar Games, YouTube, Twitch or Kick.
        </p>
      </footer>
    </>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Check className="mt-[3px] size-[17px] shrink-0 text-brand" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
