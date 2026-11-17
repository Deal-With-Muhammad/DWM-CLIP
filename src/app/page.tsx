import { Captions, Check, Hash, MessageSquareText, Scissors, Sparkles, SquarePen, Video, Wand2 } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { TryBox } from "@/components/try-box";
import { FREE, LITE, PRO, STORAGE_PACK, formatBytes } from "@/lib/plans";
import { currentUser } from "@/lib/server/session";
import { site } from "@/lib/site";

// What a finished clip looks like: the hook box on top, word-by-word captions, a score.
const SAMPLES = [
  { hook: "HE DIDN'T SEE IT", words: ["NO", "WAY", "BRO"], on: 1, score: 92, title: "The cop car came out of nowhere", tile: "bg-tile-pink", cam: true },
  { hook: "1 VS 3", words: ["WATCH", "THIS"], on: 0, score: 87, title: "Clutch escape with one bar of health", tile: "bg-tile-violet", cam: true },
  { hook: "WAIT FOR IT", words: ["OH", "MY", "GOD"], on: 2, score: 81, title: "The jump nobody thought would land", tile: "bg-tile-sky", cam: false },
];

const FEATURES = [
  { icon: Sparkles, tint: "bg-brand-soft text-brand-ink", title: "Finds the moments for you", text: "It reads what was said and listens for the loud parts, then picks the moments a stranger would stop scrolling for. Each one gets a score." },
  { icon: Captions, tint: "bg-violet-soft text-violet", title: "Captions, word by word", text: "Three caption styles, timed to the voice, with the word being said lit up. Or switch captions off." },
  { icon: MessageSquareText, tint: "bg-sky-soft text-sky", title: "A hook on every clip", text: "A short line at the top taken from what happened: \"1 VS 3\", \"HE GOT ME\". You can rewrite it any time." },
  { icon: Wand2, tint: "bg-violet-soft text-violet", title: "Tell it what you want", text: "\"Only funny moments.\" \"Police chases.\" \"Titles in Spanish.\" Type it in and the AI looks for exactly that." },
  { icon: SquarePen, tint: "bg-brand-soft text-brand-ink", title: "Change a clip after it's made", text: "New hook, another caption style, start two seconds earlier, end a little later. Save, and the clip is made again." },
  { icon: Video, tint: "bg-sky-soft text-sky", title: "The streamer stays in the picture", text: "If the video has a webcam box, it's kept in the corner of the clip. If it doesn't, the game simply fills the screen." },
  { icon: Hash, tint: "bg-brand-soft text-brand-ink", title: "Titles and hashtags that fit", text: "Every clip comes with a title, a description and the tags people search for. It knows GTA VI and 20 more games by name." },
  { icon: Scissors, tint: "bg-violet-soft text-violet", title: "Long streams are fine", text: "Videos up to three hours. It only fetches the parts it clips, so an hour-long stream takes minutes." },
];

const FAQ = [
  {
    q: "Do I need an AI key?",
    a: "Not on Lite or Pro: our AI picks the moments. On the free plan it runs on your own key from any of the big AI services, and several of them give keys away for free.",
  },
  {
    q: "Which videos can I clip?",
    a: "Any public YouTube, Twitch or Kick video: streams, gameplay, podcasts, interviews. Clip videos you made or have permission to use (for example a creator's clipping campaign). You're responsible for the rights to what you post.",
  },
  { q: "How long does it take?", a: "A 20-minute video takes about three minutes. Clips appear one by one as they finish, so you can start posting before the whole video is done." },
  { q: "What if the video has no facecam?", a: "Then the game fills the screen, and the page tells you so. Nothing is made up: the webcam is only shown when the video really has one." },
  { q: "Can I change a clip I don't like?", a: "Yes. Open it, press Edit, and change the hook, the caption style, the layout or where it starts and ends. Changing a clip doesn't use up one of your clips." },
  { q: "Is it only for GTA 6?", a: "No. It knows GTA VI and 20 other games by name, so titles and hashtags fit the game, but it works on any video where something happens or someone talks." },
  { q: "What happens when my storage is full?", a: "New clips aren't saved until you delete some or add storage. Download the clips you want to keep, delete them here, and the space is yours again." },
  { q: "Can I cancel?", a: "Yes, any time, from Settings. You keep your plan until the end of the month you paid for. If it didn't work for you, ask within 14 days of a payment and you get that payment back." },
];

export default async function Home() {
  const user = await currentUser().catch(() => null);
  const plans = [
    { plan: FREE, line: "Try it with your own AI key", cta: "Start free", href: "/signup", rows: [`${FREE.clips} clips to try it`, "Bring your own AI key", `${formatBytes(FREE.storage)} of storage`, `Videos up to ${FREE.maxHours} hour`, "Edit your clips"] },
    {
      plan: LITE,
      line: "For posting a few times a week",
      cta: "Get Lite",
      href: "/app/settings#plan",
      rows: [`${LITE.clips} clips every month`, "Our AI, no key needed", `${formatBytes(LITE.storage)} of storage`, `Videos up to ${LITE.maxHours} hours`, "Sharper 1080p source", "Edit your clips"],
    },
    {
      plan: PRO,
      line: "For clipping every day",
      cta: "Get Pro",
      href: "/app/settings#plan",
      rows: [`${PRO.clips} clips every month`, "Our AI, no key needed", `${formatBytes(PRO.storage)} of storage`, `Videos up to ${PRO.maxHours} hours`, `${PRO.clipsPerVideo} clips from one video`, "Two videos at once", "Edit your clips"],
    },
  ];
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center gap-1 px-4 sm:px-6">
          <Logo />
          <nav className="ms-auto flex items-center gap-0.5 text-[14.5px]">
            <a href="#features" className="hidden rounded-lg px-3 py-1.5 text-ink-2 hover:bg-subtle sm:block">
              Features
            </a>
            <a href="#pricing" className="hidden rounded-lg px-3 py-1.5 text-ink-2 hover:bg-subtle sm:block">
              Pricing
            </a>
            <ThemeToggle />
            {user ? (
              <Link href="/app" className="btn ms-1 h-9 px-4 text-[14.5px]">
                Open app
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-lg px-3 py-1.5 text-ink-2 hover:bg-subtle">
                  Sign in
                </Link>
                <Link href="/signup" className="btn ms-1 h-9 px-4 text-[14.5px]">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[1080px] items-center gap-12 px-4 pt-12 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-24">
          <div className="rise">
            <h1 className="font-display text-[42px] leading-[1.04] sm:text-[56px]">Paste a link. Get clips that are ready to post.</h1>
            <p className="mt-5 max-w-[510px] text-[17.5px] leading-relaxed text-ink-2">
              DWM Clip watches a stream or long video for you, finds the best moments, and turns each one into a vertical clip with captions, a hook, a title and hashtags.
            </p>
            <div className="mt-8 max-w-[530px]">
              <TryBox />
              <p className="mt-3 text-[13.5px] text-muted">
                Free to try: {FREE.clips} clips, no card. Plans from ${LITE.price} a month.
              </p>
            </div>
            <p className="mt-9 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13.5px] text-muted">
              From
              {["YouTube", "Twitch", "Kick"].map((s) => (
                <span key={s} className="rounded-md bg-subtle px-2 py-0.5 font-medium text-ink-2">
                  {s}
                </span>
              ))}
              to
              {["TikTok", "Reels", "Shorts"].map((s) => (
                <span key={s} className="rounded-md bg-brand-soft px-2 py-0.5 font-medium text-brand-ink">
                  {s}
                </span>
              ))}
            </p>
          </div>

          <div className="flex justify-center gap-3 sm:gap-4" aria-hidden>
            {SAMPLES.map((s, i) => (
              <div key={s.hook} className={`rise w-[31%] max-w-[176px] ${i === 1 ? "mt-10" : ""}`} style={{ animationDelay: `${80 + i * 70}ms` }}>
                <div className={`relative aspect-[9/16] overflow-hidden rounded-2xl ${s.tile}`}>
                  {s.cam && <span className="absolute end-2 top-2 h-[17%] w-[36%] rounded-md border-2 border-white/70 bg-white/20" />}
                  <span className="absolute inset-x-0 top-[24%] mx-auto w-fit max-w-[88%] rounded-md bg-white px-2 py-1 text-center text-[10px] leading-tight font-extrabold text-[#17122b] sm:text-[11.5px]">{s.hook}</span>
                  <span className="absolute inset-x-0 bottom-[26%] flex justify-center gap-1.5 text-[13px] font-extrabold text-white sm:text-[16px]" style={{ textShadow: "0 0 3px #17122b, 0 2px 0 #17122b" }}>
                    {s.words.map((w, k) => (
                      <span key={w} style={k === s.on ? { color: "#fff000" } : undefined}>
                        {w}
                      </span>
                    ))}
                  </span>
                  <span className="absolute start-2 bottom-2 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#17122b] tabular-nums">{s.score}</span>
                </div>
                <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-snug font-medium text-ink-2">{s.title}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="scroll-mt-16 border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-[1080px] px-4 py-16 sm:px-6">
            <h2 className="max-w-[560px] font-display text-[32px] leading-tight">Everything a clip needs, done before you open it</h2>
            <ul className="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <span className={`grid size-10 place-items-center rounded-xl ${f.tint}`}>
                    <f.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-3.5 text-[16px] font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1080px] px-4 py-16 sm:px-6">
          <h2 className="font-display text-[32px]">How it works</h2>
          <ol className="mt-9 grid gap-8 md:grid-cols-3">
            <li>
              <div className="card p-3.5">
                <div className="flex h-10 items-center rounded-lg border border-line-strong bg-canvas px-3 text-[13px] text-muted">youtube.com/watch?v=…</div>
                <div className="mt-2.5 rounded-lg bg-violet-soft px-3 py-2 text-[12.5px] text-violet">Only the funny moments</div>
              </div>
              <h3 className="mt-4 text-[17px] font-semibold">1. Paste the link</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">A stream, a gameplay video, a podcast. Say what you&apos;re after if you like, and pick how the captions should look.</p>
            </li>
            <li>
              <div className="card p-3.5">
                <div className="h-2 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full w-[62%] rounded-full bg-brand" />
                </div>
                <p className="mt-2.5 text-[13px] text-ink-2">Finding the best moments (minute 40 of 60) · 2 ready</p>
              </div>
              <h3 className="mt-4 text-[17px] font-semibold">2. It finds the moments</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Clips show up one by one while the rest of the video is still being watched.</p>
            </li>
            <li>
              <div className="card p-3.5">
                <p className="text-[13.5px] font-medium">The cop car came out of nowhere</p>
                <p className="mt-1 text-[12.5px] text-brand-ink">#GTA6 #ViceCity #RockstarGames</p>
                <div className="mt-2.5 flex gap-2 text-[12.5px]">
                  <span className="rounded-lg bg-brand px-2.5 py-1 font-medium text-white">Download</span>
                  <span className="rounded-lg border border-line-strong px-2.5 py-1">Copy caption</span>
                  <span className="rounded-lg border border-line-strong px-2.5 py-1">Edit</span>
                </div>
              </div>
              <h3 className="mt-4 text-[17px] font-semibold">3. Download and post</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">Every clip is 9:16 with captions burned in. Copy the title and tags, download, post. Not quite right? Edit it.</p>
            </li>
          </ol>
        </section>

        <section id="pricing" className="scroll-mt-16 border-y border-line bg-surface">
          <div className="mx-auto w-full max-w-[1080px] px-4 py-16 sm:px-6">
            <h2 className="font-display text-[32px]">Pricing</h2>
            <p className="mt-2 max-w-[560px] text-[16px] leading-relaxed text-ink-2">Start free. Pay when you want more clips and don&apos;t want to think about AI keys. Cancel any time.</p>
            <div className="mt-9 grid gap-4 md:grid-cols-3">
              {plans.map(({ plan, line, cta, href, rows }) => {
                const best = plan.id === "pro";
                return (
                  <div key={plan.id} className={`flex flex-col rounded-2xl p-6 ${best ? "border-2 border-brand" : "border border-line"}`}>
                    <p className="flex items-center gap-2 text-[17px] font-semibold">
                      {plan.name}
                      {best && <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[12px] font-semibold text-brand-ink">Most clips</span>}
                    </p>
                    <p className="mt-2 font-display text-[38px] leading-none">
                      ${plan.price}
                      {plan.price > 0 && <span className="text-[16px] font-normal text-muted"> /month</span>}
                    </p>
                    <p className="mt-2 text-[14px] text-muted">{line}</p>
                    <ul className="mt-5 flex-1 space-y-2.5 text-[15px] text-ink-2">
                      {rows.map((r) => (
                        <li key={r} className="flex gap-2.5">
                          <Check className="mt-[3px] size-[17px] shrink-0 text-brand" aria-hidden />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href={user && plan.id === "free" ? "/app" : href} className={`mt-6 ${best ? "btn" : "btn-quiet"}`}>
                      {cta}
                    </Link>
                  </div>
                );
              })}
            </div>
            <p className="mt-5 text-[14px] text-muted">
              Need more room? Add {formatBytes(STORAGE_PACK.bytes)} of storage to Lite or Pro for ${STORAGE_PACK.price} a month, as many times as you like.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[760px] px-4 py-16 sm:px-6">
          <h2 className="font-display text-[32px]">Questions</h2>
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

        <section className="mx-auto w-full max-w-[1080px] px-4 pb-16 sm:px-6">
          <div className="rounded-3xl bg-tile-violet px-6 py-12 text-center text-white sm:px-10">
            <h2 className="mx-auto max-w-[560px] font-display text-[30px] leading-tight">Your next clip is already sitting in a stream somewhere.</h2>
            <Link href={user ? "/app" : "/signup"} className="mt-6 inline-flex h-12 items-center rounded-xl bg-white px-6 text-[16px] font-semibold text-[#3a1fa8] transition-colors hover:bg-[#f2eeff]">
              {user ? "Open the app" : "Make your first clip free"}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-[13.5px] text-muted sm:px-6">
          <span>
            {site.name}, by{" "}
            <a href="https://www.dealwithmuhammad.com" className="underline underline-offset-4 hover:text-ink">
              Muhammad
            </a>
          </span>
          <span className="ms-auto flex flex-wrap gap-x-5 gap-y-1">
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
        <p className="mx-auto w-full max-w-[1080px] px-4 pb-6 text-[12.5px] text-muted sm:px-6">
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
