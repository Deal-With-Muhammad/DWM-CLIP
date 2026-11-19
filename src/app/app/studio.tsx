"use client";

import { Button } from "@heroui/react";
import { Check, Copy, Download, Link2, Loader, Minus, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { howLong, hoursWord, moment, videoUrl } from "@/lib/link";
import { DEFAULT_LOOK, type Look } from "@/lib/look";
import { CLIP_BYTES, LAYOUTS, formatBytes } from "@/lib/plans";
import type { Account } from "@/lib/server/account";
import type { Clip, Job } from "@/lib/server/library";

import { CaptionChoice } from "./look-picker";

type Data = { jobs: Job[]; account: Account };

// What the pasted link turned out to be. It is looked at as soon as it is pasted, so a video that can't be
// clipped says so before "Make clips" and not after. "unknown" means it couldn't be looked at just now, and
// the video may still be started.
type Found =
  | { state: "none" | "looking" | "unknown" }
  | { state: "bad"; text: string; again: boolean }
  | { state: "ok"; title: string; uploader: string; seconds: number; live: boolean; thumb: string; place: string; planSeconds: number };

const busy = (j: Job) => j.status === "queued" || j.status === "running";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const file = (c: Clip, part?: "cover") => `/api/clips/${c.id}/file?${part ? "part=cover&" : ""}v=${c.version}`;

// Things people often want, to tap instead of typing.
const IDEAS = ["Only the funny moments", "Fails and rage", "Clutch plays", "Police chases", "Moments with shouting"];

/** The whole signed-in app: paste a link, watch it being clipped, play, change and download the clips. */
export function Studio({ initial, hasKey, startUrl }: { initial: Data; hasKey: boolean; startUrl: string }) {
  const [data, setData] = useState(initial);
  const [url, setUrl] = useState(startUrl);
  const [clips, setClips] = useState(3);
  const [maxLen, setMaxLen] = useState(60);
  const [style, setStyle] = useState("bounce");
  const [captions, setCaptions] = useState(true);
  const [tighten, setTighten] = useState(true);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [layout, setLayout] = useState("auto");
  const [focus, setFocus] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ text: string; upgrade?: boolean; needsKey?: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [found, setFound] = useState<Found>({ state: videoUrl(startUrl) ? "looking" : "none" });
  const [from, setFrom] = useState(0);
  const [lookAgain, setLookAgain] = useState(0);
  const { account, jobs } = data;
  const free = account.plan === "free";
  const working = jobs.some((j) => busy(j) || j.clips.some((c) => c.status === "updating"));
  const open = openId ? jobs.flatMap((j) => j.clips).find((c) => c.id === openId) : undefined;

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    if (res.status === 401) return window.location.assign("/login?next=/app");
    if (res.ok) setData(await res.json());
  }, []);

  // While a video or a changed clip is being worked on, ask how it's going every few seconds.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [working, refresh]);

  const paste = (value: string) => {
    setUrl(value);
    setFrom(0);
    setFound({ state: videoUrl(value) ? "looking" : "none" });
  };

  // A pasted link is looked at straight away (a moment after typing stops).
  useEffect(() => {
    const link = videoUrl(url);
    if (!link) return;
    const stop = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: link }), signal: stop.signal });
        const j = await res.json().catch(() => ({}));
        if (stop.signal.aborted) return;
        if (j.ok) setFound({ state: "ok", title: j.title, uploader: j.uploader, seconds: j.seconds, live: j.live, thumb: j.thumb, place: j.place, planSeconds: j.planSeconds });
        else if (res.ok && typeof j.problem === "string" && j.problem) setFound({ state: "bad", text: j.problem, again: j.again === true });
        else setFound({ state: "unknown" });
      } catch {
        if (!stop.signal.aborted) setFound({ state: "unknown" });
      }
    }, 500);
    return () => {
      clearTimeout(t);
      stop.abort();
    };
  }, [url, lookAgain]);

  // A video longer than the plan takes at once: one stretch of it is clipped, and the member says where it starts.
  const tooLong = found.state === "ok" && !found.live && found.planSeconds > 0 && found.seconds > found.planSeconds + 1;

  const start = async () => {
    if (!url.trim() || sending || found.state === "looking" || found.state === "bad") return;
    setSending(true);
    setProblem(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          clips,
          maxLen,
          style,
          captions,
          tighten,
          layout,
          focus,
          look: style === "custom" ? look : null,
          from: tooLong ? from : 0,
          place: found.state === "ok" ? found.place : "",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setProblem({ text: j.error || "Something went wrong. Please try again.", upgrade: j.upgrade, needsKey: j.needsKey });
      paste("");
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
    setOpenId(null);
    await refresh();
  };

  const maxClips = Math.max(1, Math.min(account.clipsPerVideo, account.clipsLeft || 1));
  const needsKey = !hasKey;
  const asked = Math.min(clips, maxClips);
  // How many clips of the chosen length the video (or the stretch of it that is looked at) can hold.
  const shortest = Math.round((maxLen * 2) / 3);
  const looked = found.state === "ok" ? Math.min(found.seconds, found.planSeconds || found.seconds) : 0;
  const room = found.state === "ok" && looked > 0 ? Math.max(1, Math.floor(looked / shortest)) : asked;
  const spaceLeft = account.storage - account.used;
  const hint = LAYOUTS.find((l) => l.id === layout)?.hint;

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 pb-20 sm:px-6">
      <section className="card rise mt-6 p-4 sm:p-6">
        <h1 className="font-display text-[24px] leading-tight sm:text-[28px]">Paste a video or live stream link</h1>
        <p className="mt-1.5 text-[14.5px] text-muted">YouTube, Twitch or Kick. A stream can still be live: the clips come from what it has shown so far.</p>
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
            <input value={url} onChange={(e) => paste(e.target.value)} type="url" inputMode="url" placeholder="https://www.youtube.com/watch?v=…" autoCapitalize="none" spellCheck={false} className="field-native !h-12 ps-10" />
          </label>
          <Button type="submit" size="lg" isDisabled={sending || !url.trim() || needsKey || account.clipsLeft <= 0 || found.state === "looking" || found.state === "bad"}>
            {sending ? "Starting…" : found.state === "looking" ? "Checking the link…" : "Make clips"}
          </Button>
        </form>

        {found.state === "bad" && (
          <Note tone="danger">
            {found.text}{" "}
            {found.again && (
              <button type="button" className="font-medium underline underline-offset-4" onClick={() => {
                  setFound({ state: "looking" });
                  setLookAgain((n) => n + 1);
                }}
              >
                Check again
              </button>
            )}
          </Note>
        )}
        {found.state === "ok" && (
          <div className="mt-3 rounded-xl bg-subtle p-3">
            <div className="flex items-center gap-3">
              {found.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={found.thumb} alt="" className="h-[54px] w-24 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-medium">{found.title}</p>
                <p className="mt-0.5 truncate text-[13px] text-muted">
                  {[found.uploader, found.live ? `Live now, ${howLong(found.seconds)} so far` : found.seconds ? howLong(found.seconds) : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            {found.live && found.seconds > found.planSeconds && (
              <p className="mt-2.5 text-[13.5px] leading-snug text-ink-2">
                The clips will come from its last {hoursWord(found.planSeconds / 3600)}, the most your plan takes at once.
              </p>
            )}
            {tooLong && (
              <div className="mt-2.5">
                <p className="text-[13.5px] leading-snug text-ink-2">
                  Your plan takes {hoursWord(found.planSeconds / 3600)} of a video at a time, and this one is longer. Choose which {hoursWord(found.planSeconds / 3600)} to clip:
                </p>
                <input
                  type="range"
                  min={0}
                  max={found.seconds - found.planSeconds}
                  step={60}
                  value={from}
                  onChange={(e) => setFrom(Number(e.target.value))}
                  aria-label="Where the clipped part starts"
                  className="mt-2 w-full accent-[var(--violet)]"
                />
                <p className="mt-1 text-[13.5px] tabular-nums">
                  From <span className="font-semibold">{moment(from)}</span> to <span className="font-semibold">{moment(from + found.planSeconds)}</span>
                  {account.plan !== "pro" && (
                    <Link href="/app/settings#plan" className="ms-2 font-medium text-brand-ink underline underline-offset-4">
                      Take more at once
                    </Link>
                  )}
                </p>
              </div>
            )}
            {room < asked && (
              <p className="mt-2.5 text-[13.5px] leading-snug text-ink-2">
                {found.seconds < shortest
                  ? `It is only ${howLong(found.seconds)} long, so it will give one short clip.`
                  : `At ${howLong(looked)} it has room for ${room === 1 ? "one clip" : `${room} clips`} of this length, not ${asked}. Pick a shorter clip length for more.`}
              </p>
            )}
          </div>
        )}
        {spaceLeft > 0 && spaceLeft < asked * CLIP_BYTES && (
          <Note tone="warn">
            You have {formatBytes(spaceLeft)} of storage left, which may not hold {asked === 1 ? "this clip" : `all ${asked} clips`}. Delete clips you no longer need first
            {free ? ", or pick a plan for more room." : ", or add storage."}
          </Note>
        )}

        <div className="mt-6 grid gap-x-8 gap-y-4 md:grid-cols-2">
          <Choice label="How many clips">
            <div className="seg">
              {[1, 2, 3, 5, 8, 10]
                .filter((n) => n <= maxClips)
                .map((n) => (
                  <button key={n} type="button" aria-pressed={Math.min(clips, maxClips) === n} onClick={() => setClips(n)}>
                    {n}
                  </button>
                ))}
            </div>
          </Choice>
          <Choice label="Clip length, up to">
            <div className="seg">
              {[30, 60, 90].map((n) => (
                <button key={n} type="button" aria-pressed={maxLen === n} onClick={() => setMaxLen(n)}>
                  {n} sec
                </button>
              ))}
            </div>
          </Choice>
          <Choice label="Captions">
            <CaptionChoice style={style} captions={captions} look={look} onStyle={setStyle} onCaptions={setCaptions} onLook={setLook} />
          </Choice>
          <Choice label="Layout">
            <div className="seg">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" aria-pressed={layout === l.id} onClick={() => setLayout(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <LayoutPicture id={layout} />
              <p className="text-[12.5px] leading-snug text-muted">{hint}</p>
            </div>
          </Choice>
          <Choice label="Quiet parts" hint={tighten ? "Pauses where nobody talks and nothing happens are cut out, so the clip moves faster." : "Each clip is one unbroken piece of the video."}>
            <div className="seg">
              <button type="button" aria-pressed={tighten} onClick={() => setTighten(true)}>
                Cut them out
              </button>
              <button type="button" aria-pressed={!tighten} onClick={() => setTighten(false)}>
                Keep them
              </button>
            </div>
          </Choice>
          <label className="block md:col-span-2">
            <span className="text-[13.5px] font-medium">
              Tell the AI what to look for <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value.slice(0, 300))}
              rows={2}
              placeholder="For example: only the funny moments, and write the titles in Spanish"
              className="field-native mt-1.5 resize-none py-2.5 leading-snug"
            />
            <span className="mt-2 flex flex-wrap gap-1.5">
              {IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setFocus(idea)} className="rounded-full bg-violet-soft px-2.5 py-1 text-[12.5px] text-violet transition-colors hover:bg-subtle">
                  {idea}
                </button>
              ))}
            </span>
          </label>
        </div>

        {needsKey && (
          <Note tone="warn">
            The AI that picks the moments runs on your own key, and several services give one away for free.{" "}
            <Link href="/app/settings#ai" className="font-medium underline underline-offset-4">
              Add your key
            </Link>{" "}
            to start.
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
                See plans
              </Link>
            )}
          </Note>
        )}
        {!problem && !needsKey && account.clipsLeft <= 0 && (
          <Note tone="warn">
            You&apos;ve made the most clips this plan allows in a month. It resets on the 1st.{" "}
            {account.plan !== "pro" && (
              <Link href="/app/settings#plan" className="font-medium underline underline-offset-4">
                {free ? "Pick a plan from $2" : "Move up to Pro"}
              </Link>
            )}
          </Note>
        )}
      </section>

      <Meters account={account} />

      <section className="mt-9">
        <h2 className="font-display text-[20px]">Your videos</h2>
        {jobs.length === 0 ? (
          <p className="card mt-3 px-5 py-12 text-center text-[15px] text-muted">Nothing here yet. Paste a link above and your clips will show up here.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {jobs.map((j) => (
              <li key={j.id} className="card p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-medium">{j.title || j.url}</p>
                    <p className="mt-0.5 truncate text-[13px] text-muted">{[j.uploader, j.duration ? clock(j.duration) : "", j.game].filter(Boolean).join(" · ") || j.url}</p>
                    {j.focus && <p className="mt-1.5 w-fit max-w-full truncate rounded-md bg-violet-soft px-2 py-0.5 text-[12.5px] text-violet">You asked for: {j.focus}</p>}
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
                {j.clips.length > 0 && j.note && <p className="mt-2 text-[13px] text-muted">{j.note}</p>}

                {j.clips.length > 0 && (
                  <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
                    {j.clips.map((c) => (
                      <li key={c.id} className="rise">
                        <button type="button" onClick={() => setOpenId(c.id)} className="group block w-full text-start">
                          <span className="relative block aspect-[9/16] overflow-hidden rounded-xl bg-subtle">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={file(c, "cover")} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                            <span className="absolute start-2 top-2 rounded-md bg-white px-1.5 py-0.5 text-[12px] font-semibold text-[#17122b] tabular-nums">{c.score}</span>
                            <span className="absolute end-2 bottom-2 rounded-md bg-[#17122b]/80 px-1.5 py-0.5 text-[12px] text-white tabular-nums">{clock(c.seconds)}</span>
                            {c.status === "updating" ? (
                              <span className="absolute inset-0 grid place-items-center bg-[#17122b]/65 text-[13px] font-medium text-white">
                                <span className="flex items-center gap-2">
                                  <Loader className="size-4 animate-spin" aria-hidden /> Updating
                                </span>
                              </span>
                            ) : (
                              <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                                <span className="grid size-11 place-items-center rounded-full bg-white text-[#17122b]">
                                  <Play className="size-5 translate-x-px fill-current" aria-hidden />
                                </span>
                              </span>
                            )}
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

      {open && <Player key={`${open.id}:${open.version}`} clip={open} onClose={() => setOpenId(null)} onDelete={() => remove(`/api/clips/${open.id}`, "Delete this clip?")} onChanged={refresh} />}
    </div>
  );
}

function Choice({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13.5px] font-medium">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

/** A small drawing of the tall clip, showing where the game and the streamer go in the chosen layout. */
function LayoutPicture({ id }: { id: string }) {
  const game = "absolute inset-x-0 bg-violet";
  const face = (size: string) => <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ${size}`} />;
  return (
    <span aria-hidden className="relative block h-[64px] w-[36px] shrink-0 overflow-hidden rounded-md bg-subtle">
      {id === "follow" ? (
        <>
          <span className="absolute inset-x-0 top-0 h-[21px] bg-pink">{face("size-[9px]")}</span>
          <span className={`${game} top-[22px] bottom-0`} />
        </>
      ) : id === "blur" ? (
        <>
          <span className="absolute inset-0 bg-violet-soft" />
          <span className={`${game} top-[22px] h-[20px]`} />
        </>
      ) : (
        <>
          <span className={`${game} inset-y-0`} />
          {id === "auto" && <span className="absolute end-[3px] top-[3px] h-[10px] w-[14px] rounded-[2px] bg-pink">{face("size-[5px]")}</span>}
        </>
      )}
    </span>
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
  const full = account.used / account.storage;
  return (
    <section className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="card px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13.5px] text-muted">Clips this month</p>
          <p className="text-[13.5px] tabular-nums">
            <span className="font-semibold">{account.clipsMade}</span> made
          </p>
        </div>
        {/* There is no count to run out of: the storage beside this is the limit. */}
        <p className="mt-2 text-[12.5px] leading-snug text-muted">Your storage is the limit. Delete clips to make room for new ones.</p>
      </div>
      <div className="card px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13.5px] text-muted">Storage</p>
          <p className="text-[13.5px] tabular-nums">
            <span className="font-semibold">{formatBytes(account.used)}</span> of {formatBytes(account.storage)}
            {full > 0.8 && (
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

/** One clip, playing, with the text to post beside it and a tab for changing it. */
function Player({ clip, onClose, onDelete, onChanged }: { clip: Clip; onClose: () => void; onDelete: () => void; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState<"post" | "edit">("post");
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const post = [clip.title, clip.description, clip.hashtags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n");
  const updating = clip.status === "updating";

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#0a0714]/70 p-3 sm:p-6" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={clip.title || "Clip"}
        className="rise flex max-h-full w-full max-w-[820px] flex-col overflow-auto rounded-2xl bg-surface outline-none sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-[#0a0714] sm:w-[330px] sm:shrink-0">
          <video src={file(clip)} poster={file(clip, "cover")} controls autoPlay playsInline className="aspect-[9/16] max-h-[48dvh] w-full object-contain sm:max-h-[86dvh]" />
          {updating && (
            <div className="absolute inset-0 grid place-items-center bg-[#0a0714]/75 px-6 text-center text-[14px] text-white">
              <span>
                <Loader className="mx-auto mb-2 size-5 animate-spin" aria-hidden />
                Making the new version. This takes about a minute.
              </span>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-5">
          <div className="flex items-center gap-3">
            <div className="seg">
              <button type="button" aria-pressed={tab === "post"} onClick={() => setTab("post")}>
                Post
              </button>
              <button type="button" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>
                <Pencil className="-mt-0.5 me-1 inline size-3.5" aria-hidden />
                Edit
              </button>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="ms-auto -me-2 rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          {clip.error && !updating && (
            <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
              The last change didn&apos;t work: {clip.error}
            </p>
          )}

          {tab === "post" ? (
            <>
              <h3 className="mt-4 font-display text-[20px] leading-snug">{clip.title || clip.hook || "Clip"}</h3>
              <p className="mt-1 text-[13px] text-muted">
                Score {clip.score} · {clock(clip.seconds)} · {formatBytes(clip.bytes)}
              </p>
              {clip.description && <p className="mt-4 text-[14.5px] leading-relaxed text-ink-2">{clip.description}</p>}
              {clip.hashtags.length > 0 && <p className="mt-3 text-[14px] leading-relaxed text-brand-ink">{clip.hashtags.map((t) => `#${t}`).join(" ")}</p>}
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <a href={`${file(clip)}&download=1`} className="btn">
                  <Download className="size-[18px]" aria-hidden /> Download
                </a>
                <Button
                  variant="tertiary"
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
            </>
          ) : (
            <Editor clip={clip} disabled={updating} onSaved={onChanged} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Moves where a clip starts or ends, a second at a time, up to 8 seconds either way. */
function Nudge({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[86px] text-[13.5px] text-ink-2">{label}</span>
      <button type="button" aria-label={`${label} one second earlier`} disabled={value <= -8} onClick={() => set(value - 1)} className="grid size-8 place-items-center rounded-lg bg-subtle hover:bg-line disabled:opacity-40">
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="w-[92px] text-center text-[13.5px] tabular-nums">{value === 0 ? "as it is" : `${Math.abs(value)} sec ${value < 0 ? "earlier" : "later"}`}</span>
      <button type="button" aria-label={`${label} one second later`} disabled={value >= 8} onClick={() => set(value + 1)} className="grid size-8 place-items-center rounded-lg bg-subtle hover:bg-line disabled:opacity-40">
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Change a clip: its words (saved at once) and how it looks (the clip is made again, about a minute). */
function Editor({ clip, disabled, onSaved }: { clip: Clip; disabled: boolean; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(clip.title);
  const [description, setDescription] = useState(clip.description);
  const [hook, setHook] = useState(clip.hook);
  const [style, setStyle] = useState(clip.style);
  const [captions, setCaptions] = useState(clip.captions);
  const [look, setLook] = useState<Look>(clip.look ?? DEFAULT_LOOK);
  const [layout, setLayout] = useState(clip.layout);
  const [startBy, setStartBy] = useState(0);
  const [endBy, setEndBy] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const length = clip.end + endBy - (clip.start + startBy);
  const newLook = style === "custom" && JSON.stringify(look) !== JSON.stringify(clip.look);
  const looks = hook.trim().toUpperCase() !== clip.hook || style !== clip.style || newLook || captions !== clip.captions || layout !== clip.layout || startBy !== 0 || endBy !== 0;
  const words = title !== clip.title || description !== clip.description;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/clips/${clip.id}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, description, hook, style, captions, layout, look: style === "custom" ? look : null, start: clip.start + startBy, end: clip.end + endBy }),
    }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setMessage({ ok: false, text: j?.error || "Couldn't save. Please try again." });
    setMessage({ ok: true, text: j.remaking ? "Saved. The clip is being made again with your changes." : "Saved." });
    await onSaved();
  };

  if (!clip.editable) return <p className="mt-5 text-[14.5px] leading-relaxed text-ink-2">This clip was made before clips could be changed. Paste the video link again to get a fresh one you can edit.</p>;

  return (
    <fieldset disabled={disabled || busy} className="mt-4 space-y-4 disabled:opacity-60">
      <label className="block text-[13.5px]">
        <span className="mb-1.5 block font-medium">Hook (the line on the video)</span>
        <input value={hook} onChange={(e) => setHook(e.target.value.slice(0, 60))} className="field-native uppercase" />
      </label>
      <Choice label="Captions">
        <CaptionChoice style={style} captions={captions} look={look} onStyle={setStyle} onCaptions={setCaptions} onLook={setLook} />
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
      <div>
        <p className="mb-2 text-[13.5px] font-medium">
          Trim <span className="font-normal text-muted">(the clip will be {clock(Math.max(0, length))} long)</span>
        </p>
        <div className="space-y-2">
          <Nudge label="Start" value={startBy} set={setStartBy} />
          <Nudge label="End" value={endBy} set={setEndBy} />
        </div>
      </div>
      <label className="block text-[13.5px]">
        <span className="mb-1.5 block font-medium">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} className="field-native" />
      </label>
      <label className="block text-[13.5px]">
        <span className="mb-1.5 block font-medium">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 400))} rows={2} className="field-native resize-none py-2.5 leading-snug" />
      </label>
      {message && (
        <p role={message.ok ? undefined : "alert"} className={`rounded-xl px-3.5 py-2.5 text-[13.5px] ${message.ok ? "bg-sky-soft text-sky" : "bg-danger-soft text-danger"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onPress={save} isDisabled={disabled || busy || (!looks && !words) || length < 5 || length > 120}>
          {busy ? "Saving…" : looks ? "Save and remake clip" : "Save"}
        </Button>
        <span className="text-[12.5px] text-muted">{looks ? "Takes about a minute. Doesn't use up one of your clips." : "Title and description save straight away."}</span>
      </div>
    </fieldset>
  );
}
