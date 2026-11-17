import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { LAYOUTS, SITES, STYLES } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { first, nowIso, run } from "@/lib/server/db";
import { engineReady, startJob } from "@/lib/server/engine";
import { hit } from "@/lib/server/auth-helpers";
import { fail, siteOrigin } from "@/lib/server/http";
import { keyFor } from "@/lib/server/keys";
import { listJobs } from "@/lib/server/library";
import { currentUser } from "@/lib/server/session";
import { setting } from "@/lib/server/settings";

// GET: the member's videos and clips, plus what they have left. The page asks every few seconds while a video is being worked on.
export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const [jobs, account] = await Promise.all([listJobs(user.id), accountOf(user)]);
  return NextResponse.json({ jobs, account }, { headers: { "cache-control": "no-store" } });
}

function videoUrl(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return SITES.some((s) => host === s || host.endsWith(`.${s}`)) ? u.toString() : null;
  } catch {
    return null;
  }
}

const between = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback);

// POST: start clipping a link.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  let body: { url?: unknown; clips?: unknown; style?: unknown; layout?: unknown; maxLen?: unknown; captions?: unknown; ownKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.");
  }
  const url = videoUrl(body.url);
  if (!url) return fail(400, "Paste a YouTube, Twitch or Kick video link.");
  if ((await hit(`clip:job:${user.id}`, 3600)) > 30) return fail(429, "That's a lot of videos in an hour. Try again a little later.");

  const account = await accountOf(user);
  if (account.clipsLeft <= 0) {
    return fail(402, account.plan === "pro" ? "You've used this month's clips. They reset on the 1st." : "You've used your free clips. Upgrade to Pro to keep clipping.", { upgrade: account.plan !== "pro" });
  }
  if (account.used >= account.storage) return fail(402, "Your storage is full. Delete some clips or add storage.", { upgrade: true });
  const running = await first<{ n: number }>("select count(*) as n from jobs where user_id = ? and status in ('queued', 'running')", user.id);
  if ((running?.n ?? 0) >= account.jobsAtOnce) return fail(409, account.jobsAtOnce === 1 ? "One video at a time on the free plan. Wait for this one to finish." : "Two videos are already being clipped. Wait for one to finish.");

  // Whose AI picks the moments: ours for Pro (unless they'd rather use their own key), the member's own on the free plan.
  const own = await keyFor(user.id);
  const useOwn = account.plan !== "pro" || (body.ownKey === true && Boolean(own));
  let ai: { provider: string; model: string; key: string } | null;
  if (useOwn) {
    if (!own) return fail(400, "Add your AI key first (it's free from Google AI Studio).", { needsKey: true });
    ai = own;
  } else {
    const key = setting("AI_KEY");
    if (!key) return fail(503, "Clipping isn't switched on yet. Please try again soon.");
    ai = { provider: setting("AI_PROVIDER") || "gemini", model: setting("AI_MODEL") || "gemini-2.5-flash-lite", key };
  }
  if (!engineReady()) return fail(503, "Clipping isn't switched on yet. Please try again soon.");

  const options = {
    max_clips: Math.min(between(body.clips, 1, 20, 3), account.clipsPerVideo, account.clipsLeft),
    min_len: 15,
    max_len: between(body.maxLen, 20, 90, 60),
    style: STYLES.some((s) => s.id === body.style) ? (body.style as string) : "bounce",
    layout: LAYOUTS.some((l) => l.id === body.layout) ? (body.layout as string) : "gameplay",
    captions: body.captions !== false,
    quality: account.plan === "pro" ? 1080 : 720,
  };
  const id = randomUUID();
  const at = nowIso();
  await run(
    "insert into jobs (id, user_id, url, status, stage, options, ai_mode, model, created_at, updated_at) values (?, ?, ?, 'queued', 'Starting', ?, ?, ?, ?, ?)",
    id,
    user.id,
    url,
    JSON.stringify(options),
    useOwn ? "own" : "ours",
    ai.model,
    at,
    at,
  );
  try {
    await startJob({ id, url, callback: `${siteOrigin(req)}/api/engine`, options, ai, max_hours: account.maxHours });
  } catch (e) {
    const busy = e instanceof Error && e.message === "busy";
    console.error("engine start", e);
    await run("delete from jobs where id = ?", id);
    return fail(503, busy ? "Lots of videos are being clipped right now. Try again in a minute." : "Couldn't start clipping. Please try again.");
  }
  return NextResponse.json({ ok: true, id });
}
