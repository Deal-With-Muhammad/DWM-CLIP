import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { cleanLook } from "@/lib/look";
import { videoUrl } from "@/lib/link";
import { ENGINE_LAYOUT, HOURS_CLIPS_PER_VIDEO, HOURS_PER_VIDEO, LAYOUTS, LITE, PLAN_DAYS, RETIRED_MODELS, STYLES } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { first, nowIso, run } from "@/lib/server/db";
import { ALL_PLACES, engineReady, startJob } from "@/lib/server/engine";
import { hit } from "@/lib/server/auth-helpers";
import { fail, siteOrigin } from "@/lib/server/http";
import { keyFor } from "@/lib/server/keys";
import { listJobs } from "@/lib/server/library";
import { currentUser } from "@/lib/server/session";

// GET: the member's videos and clips, plus what they have left. The page asks every few seconds while a video is being worked on.
export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const [jobs, account] = await Promise.all([listJobs(user.id), accountOf(user)]);
  return NextResponse.json({ jobs, account }, { headers: { "cache-control": "no-store" } });
}

const between = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback);

// POST: start clipping a link.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  let body: { url?: unknown; clips?: unknown; style?: unknown; layout?: unknown; maxLen?: unknown; captions?: unknown; tighten?: unknown; focus?: unknown; look?: unknown; from?: unknown; place?: unknown; useHours?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.");
  }
  const url = videoUrl(body.url);
  if (!url) return fail(400, "Paste a YouTube, Twitch or Kick link: a video, or a stream that is live now.");
  if ((await hit(`clip:job:${user.id}`, 3600)) > 30) return fail(429, "That's a lot of videos in an hour. Try again a little later.");

  const account = await accountOf(user);
  // Bought video hours: this video is clipped for up to `paidHours` and doesn't use one of the plan's videos.
  const askedHours = typeof body.useHours === "number" && Number.isFinite(body.useHours) ? body.useHours : 0;
  const paidHours = askedHours > 0 ? Math.round(Math.min(askedHours, HOURS_PER_VIDEO, account.hoursLeft) * 100) / 100 : 0;
  if (askedHours > 0 && paidHours < 0.05) return fail(402, "You have no video hours left. Buy more in Settings.", { upgrade: true });
  if (!paidHours && account.videosLeft <= 0) {
    return fail(
      402,
      account.plan === "free"
        ? `${account.freeWaits ?? `You've used your free ${account.videos === 1 ? "video" : `${account.videos} videos`} this month.`} ${account.freeWaits ? "New videos need a plan" : "Pick a plan to keep clipping"}: Lite is $${LITE.price} for ${PLAN_DAYS} days (${LITE.videos} videos), or buy video hours from $3.`
        : account.pass
          ? `You've clipped all ${account.videos} videos of these ${PLAN_DAYS} days. Add ${PLAN_DAYS} more days in Settings, or use video hours.`
          : `You've clipped all ${account.videos} videos your plan gives this month. It resets on the 1st.`,
      { upgrade: account.plan !== "pro" },
    );
  }
  if (account.clipsLeft <= 0) {
    return fail(402, "You've made the most clips this plan allows in a month. It resets on the 1st.", { upgrade: account.plan !== "pro" });
  }
  if (account.used >= account.storage) return fail(402, account.plan === "free" ? "Your storage is full. Delete some clips to make room, or pick a plan for more." : "Your storage is full. Delete some clips or add storage.", { upgrade: true });
  const running = await first<{ n: number }>("select count(*) as n from jobs where user_id = ? and status in ('queued', 'running')", user.id);
  if ((running?.n ?? 0) >= account.jobsAtOnce) return fail(409, account.jobsAtOnce === 1 ? "One video at a time on this plan. Wait for this one to finish." : "Two videos are already being clipped. Wait for one to finish.");

  // The moments are picked with the member's own AI key, on every plan.
  let ai = await keyFor(user.id);
  if (!ai) return fail(400, "Add your AI key first. Several services give one away for free.", { needsKey: true });
  // A member's own Gemini key: a retired model is swapped for the one Google replaced it with, and the other
  // current models are kept as further tries. A free key has a separate small allowance for each model, so one
  // model that has run out doesn't leave the clips without the AI.
  if (ai.provider === "gemini") {
    ai = { ...ai, model: [...new Set([RETIRED_MODELS[ai.model], ai.model, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash"].filter(Boolean))].join(",") };
  }
  if (!engineReady()) return fail(503, "Clipping isn't switched on yet. Please try again soon.");

  // The length the member chose is the longest a clip may be; two thirds of it is the shortest, so "60 sec"
  // gives clips of 40 to 60 seconds and never a 17-second one.
  const maxLen = between(body.maxLen, 20, 90, 60);
  const options = {
    max_clips: Math.min(between(body.clips, 1, 20, 3), paidHours ? Math.max(account.clipsPerVideo, HOURS_CLIPS_PER_VIDEO) : account.clipsPerVideo, account.clipsLeft),
    min_len: Math.round((maxLen * 2) / 3),
    max_len: maxLen,
    // "custom" is the member's own look, sent to the engine beside the options.
    style: STYLES.some((s) => s.id === body.style) ? (body.style as string) : "bounce",
    layout: ENGINE_LAYOUT[LAYOUTS.some((l) => l.id === body.layout) ? (body.layout as string) : "auto"],
    captions: body.captions !== false,
    // Pauses where nobody speaks and nothing happens are cut out of each clip, unless the member says to leave them.
    tighten: body.tighten !== false,
    quality: account.quality,
  };
  // What the member asked the AI to look for: one short line of plain text.
  const focus = typeof body.focus === "string" ? body.focus.replace(/[\x00-\x1f\x7f{}]+/g, " ").trim().slice(0, 300) : "";
  const id = randomUUID();
  const at = nowIso();
  await run(
    "insert into jobs (id, user_id, url, status, stage, options, focus, ai_mode, model, paid_hours, plan, created_at, updated_at) values (?, ?, ?, 'queued', 'Starting', ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    url,
    JSON.stringify(options),
    focus,
    "own",
    ai.model,
    paidHours,
    paidHours ? "hours" : account.plan,
    at,
    at,
  );
  try {
    await startJob({
      id,
      url,
      callback: `${siteOrigin(req)}/api/engine`,
      options,
      ai,
      max_hours: paidHours || account.maxHours,
      focus,
      look: body.style === "custom" ? cleanLook(body.look) : null,
      // For a video longer than the plan takes at once: where the member wants the clipped stretch to start.
      from: typeof body.from === "number" && Number.isFinite(body.from) ? Math.max(0, Math.round(body.from)) : 0,
      // Where the link check got through to the video site, so the video starts there too.
      place: typeof body.place === "string" && ALL_PLACES.includes(body.place) ? body.place : "",
    });
  } catch (e) {
    const busy = e instanceof Error && e.message === "busy";
    console.error("engine start", e);
    await run("delete from jobs where id = ?", id);
    return fail(503, busy ? "Lots of videos are being clipped right now. Try again in a minute." : "Couldn't start clipping. Please try again.");
  }
  return NextResponse.json({ ok: true, id });
}
