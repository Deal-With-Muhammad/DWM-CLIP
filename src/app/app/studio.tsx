"use client";

import { Button } from "@heroui/react";
import { Check, Copy, Download, Link2, Play, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { LAYOUTS, STYLES, formatBytes } from "@/lib/plans";
import type { Account } from "@/lib/server/account";
import type { Clip, Job } from "@/lib/server/library";

type Data = { jobs: Job[]; account: Account };

const busy = (j: Job) => j.status === "queued" || j.status === "running";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** The whole signed-in app: paste a link, watch it being clipped, play and download the clips. */
export function Studio({ initial, hasKey, startUrl }: { initial: Data; hasKey: boolean; startUrl: string }) {
  const [data, setData] = useState(initial);
  const [url, setUrl] = useState(startUrl);
  const [clips, setClips] = useState(3);
  const [style, setStyle] = useState("bounce");
  const [layout, setLayout] = useState("gameplay");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ text: string; upgrade?: boolean; needsKey?: boolean } | null>(null);
  const [open, setOpen] = useState<Clip | null>(null);
  const { account, jobs } = data;
  const pro = account.plan === "pro";
  const working = jobs.some(busy);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (res.status === 401) return window.location.assign("/login?next=/app");
    if (res.ok) setData(await res.json());
  }, []);

  // While a video is being worked on, ask how it's going every few seconds.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [working, refresh]);

  const start = async () => {
    if (!url.trim() || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), clips, style, layout }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setProblem({ text: j.error || "Something went wrong. Please try again.", upgrade: j.upgrade, needsKey: j.needsKey });
      setUrl("");
      await refresh();
    } catch {
      setProblem({ text: "Couldn't reach the site. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  };

  const remove = async (path: string, question: string) => {
    if (!window.confirm(question)) return;
    await fetch(path, { method: "DELETE" });
    setOpen(null);
    await refresh();
  };

  const maxClips = Math.max(1, Math.min(account.clipsPerVideo, account.clipsLeft || 1));
  const needsKey = !pro && !hasKey;

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pb-20 sm:px-6">
      <section className="card mt-6 p-4 sm:p-6">
        <h1 className="font-display text-[24px] leading-tight sm:text-[28px]">Paste a video link</h1>
        <p className="mt-1.5 text-[14.5px] text-muted">YouTube, Twitch or Kick. Streams and long videos work best.</p>
        <form
          className="mt-4 flex flex-col gap-2.5 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <label className="relative flex-1">
            <span className="sr-only">Video link</span>
            <Link2 className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=…"
              autoCapitalize="none"
              spellCheck={false}
              className="field-native h-12 ps-10"
            />
          </label>
          <Button type="submit" size="lg" isDisabled={sending || !url.trim() || needsKey || account.clipsLeft <= 0}>
            {sending ? "Starting…" : "Make clips"}
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13.5px]">
          <Choice label="Clips">
            <div className="seg">
              {[1, 2, 3, 5, 8, 10]
                .filter((n) => n <= Math.max(maxClips, 1))
                .map((n) => (
                  <button key={n} type="button" aria-pressed={Math.min(clips, maxClips) === n} onClick={() => setClips(n)}>
                    {n}
                  </button>
                ))}
            </div>
          </Choice>
          <Choice label="Captions">
            <div className="seg">
              {STYLES.map((s) => (
                <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setStyle(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          </Choice>
          <Choice label="Layout">
            <div className="seg">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
          </Choice>
        </div>

        {needsKey && (
          <Note tone="warn">
            The free plan uses your own AI key to pick the moments. A Gemini key is free and takes a minute.{" "}
            <Link href="/app/settings#ai" className="font-medium underline underline-offset-4">
              Add your key
            </Link>{" "}
            or{" "}
            <Link href="/app/settings#plan" className="font-medium underline underline-offset-4">
              go Pro
            </Link>{" "}
            and skip it.
          </Note>
        )}
        {problem && (
          <Note tone="danger">
            {problem.text}{" "}
            {problem.needsKey && (
              <Link href="/app/settings#ai" className="font-medium underline underline-offset-4">
                Add your key
              </Link>
            )}
            {problem.upgrade && (
              <Link href="/app/settings#plan" className="font-medium underline underline-offset-4">
                See Pro
              </Link>
            )}
          </Note>
        )}
        {!problem && !needsKey && account.clipsLeft <= 0 && (
          <Note tone="warn">
            {pro ? "You've used this month's clips. They reset on the 1st." : "You've used your 2 free clips."}{" "}
            {!pro && (
              <Link href="/app/settings#plan" className="font-medium underline underline-offset-4">
                Upgrade to Pro
              </Link>
            )}
          </Note>
        )}
      </section>

      <Meters account={account} />

      <section className="mt-8">
        <h2 className="font-display text-[20px]">Your videos</h2>
        {jobs.length === 0 ? (
          <p className="card mt-3 px-5 py-10 text-center text-[15px] text-muted">Nothing here yet. Paste a link above and your clips will show up here.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {jobs.map((j) => (
              <li key={j.id} className="card p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-medium">{j.title || j.url}</p>
                    <p className="mt-0.5 truncate text-[13px] text-muted">
                      {[j.uploader, j.duration ? clock(j.duration) : "", j.game].filter(Boolean).join(" · ") || j.url}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete this video and its clips"
                    className="-me-1 -mt-1 rounded-lg p-2 text-muted transition-colors hover:bg-subtle hover:text-danger"
                    onClick={() => remove(`/api/jobs/${j.id}`, busy(j) ? "Stop this video and delete it?" : "Delete this video and all its clips?")}
                  >
                    <Trash2 className="size-[18px]" aria-hidden />
                  </button>
                </div>

                {busy(j) && (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(j.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="bar-moving h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(4, j.progress * 100)}%` }} />
                    </div>
                    <p className="mt-2 text-[13.5px] text-ink-2">
                      {j.stage}
                      {j.clips.length > 0 && ` · ${j.clips.length} ready`}
                    </p>
                  </div>
                )}
                {j.status === "error" && <Note tone="danger">{j.error || "Something went wrong with this video."}</Note>}
                {j.status === "done" && j.clips.length === 0 && <Note tone="warn">{j.note || "No moment in this video stood out enough to clip. Try a longer or livelier one."}</Note>}
                {j.status === "done" && j.clips.length > 0 && j.note && <p className="mt-2 text-[13px] text-muted">{j.note}</p>}

                {j.clips.length > 0 && (
                  <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                    {j.clips.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setOpen(c)} className="group block w-full text-start">
                          <span className="relative block aspect-[9/16] overflow-hidden rounded-xl bg-ink">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/clips/${c.id}/file?part=cover`} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                            <span className="absolute start-2 top-2 rounded-md bg-white px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-ink">{c.score}</span>
                            <span className="absolute end-2 bottom-2 rounded-md bg-ink/80 px-1.5 py-0.5 text-[12px] tabular-nums text-white">{clock(c.seconds)}</span>
                            <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                              <span className="grid size-11 place-items-center rounded-full bg-white text-ink">
                                <Play className="size-5 translate-x-px fill-current" aria-hidden />
                              </span>
                            </span>
                          </span>
                          <span className="mt-2 line-clamp-2 block text-[13.5px] leading-snug font-medium">{c.title || c.hook || "Clip"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && <Player clip={open} onClose={() => setOpen(null)} onDelete={() => remove(`/api/clips/${open.id}`, "Delete this clip?")} />}
    </div>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

function Note({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <p role={tone === "danger" ? "alert" : undefined} className={`mt-4 rounded-xl px-3.5 py-2.5 text-[14px] leading-snug ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn-ink"}`}>
      {children}
    </p>
  );
}

/** Clips left and storage used, with the way to get more. */
function Meters({ account }: { account: Account }) {
  const pro = account.plan === "pro";
  const full = account.used / account.storage;
  return (
    <section className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="card px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13.5px] text-muted">{pro ? "Clips this month" : "Free clips"}</p>
          <p className="text-[13.5px] tabular-nums">
            <span className="font-semibold">{account.clipsLeft}</span> of {account.clips} left
          </p>
        </div>
        <Bar value={account.clipsMade / account.clips} />
      </div>
      <div className="card px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13.5px] text-muted">Storage</p>
          <p className="text-[13.5px] tabular-nums">
            <span className="font-semibold">{formatBytes(account.used)}</span> of {formatBytes(account.storage)}
            {(!pro || full > 0.8) && (
              <Link href="/app/settings#plan" className="ms-2 font-medium text-brand-ink underline underline-offset-4">
                Get more
              </Link>
            )}
          </p>
        </div>
        <Bar value={full} />
      </div>
    </section>
  );
}

function Bar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-subtle">
      <div className={`h-full rounded-full ${v > 0.9 ? "bg-danger" : "bg-brand"}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** One clip, playing, with the text to post beside it. */
function Player({ clip, onClose, onDelete }: { clip: Clip; onClose: () => void; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const post = [clip.title, clip.description, clip.hashtags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n");

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    box.current?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-3 sm:p-6" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={clip.title || "Clip"}
        className="flex max-h-full w-full max-w-[760px] flex-col overflow-auto rounded-2xl bg-surface outline-none sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <video src={`/api/clips/${clip.id}/file`} poster={`/api/clips/${clip.id}/file?part=cover`} controls autoPlay playsInline className="aspect-[9/16] max-h-[52dvh] w-full bg-ink object-contain sm:max-h-[84dvh] sm:w-[320px] sm:shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col p-5">
          <div className="flex items-start gap-3">
            <h3 className="min-w-0 flex-1 font-display text-[20px] leading-snug">{clip.title || clip.hook || "Clip"}</h3>
            <button type="button" aria-label="Close" onClick={onClose} className="-me-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Score {clip.score} · {clock(clip.seconds)} · {formatBytes(clip.bytes)}
          </p>
          {clip.description && <p className="mt-4 text-[14.5px] leading-relaxed text-ink-2">{clip.description}</p>}
          {clip.hashtags.length > 0 && <p className="mt-3 text-[14px] leading-relaxed text-brand-ink">{clip.hashtags.map((t) => `#${t}`).join(" ")}</p>}
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <a href={`/api/clips/${clip.id}/file?download=1`} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-medium text-white transition-colors hover:bg-brand-ink">
              <Download className="size-[18px]" aria-hidden /> Download
            </a>
            <Button
              variant="outline"
              onPress={async () => {
                await navigator.clipboard.writeText(post).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? <Check className="size-[18px]" aria-hidden /> : <Copy className="size-[18px]" aria-hidden />} {copied ? "Copied" : "Copy caption"}
            </Button>
            <Button variant="tertiary" onPress={onDelete} aria-label="Delete this clip">
              <Trash2 className="size-[18px]" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
