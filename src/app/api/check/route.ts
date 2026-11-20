import { NextResponse } from "next/server";

import { videoUrl } from "@/lib/link";
import { accountOf } from "@/lib/server/account";
import { hit } from "@/lib/server/auth-helpers";
import { ALL_PLACES, checkLink, engineReady } from "@/lib/server/engine";
import { fail } from "@/lib/server/http";
import { currentUser } from "@/lib/server/session";

// POST: look at a pasted link before anything is made from it. The page shows what it is (name, channel,
// length) or why it can't be clipped, so a member finds out here and not after pressing "Make clips".
// `unknown: true` means the link couldn't be looked at just now; the page then lets the video start as before.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  let body: { url?: unknown; place?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.");
  }
  const url = videoUrl(body.url);
  if (!url) return NextResponse.json({ ok: false, problem: "Paste a YouTube, Twitch or Kick link: a video, or a stream that is live now." });
  if ((await hit(`clip:check:${user.id}`, 3600)) > 90) return NextResponse.json({ ok: false, unknown: true });
  if (!engineReady()) return NextResponse.json({ ok: false, unknown: true });
  // Looking at a link starts a container, which costs money: not worth it when the member can't clip it this month.
  const account = await accountOf(user);
  if (account.videosLeft <= 0) return NextResponse.json({ ok: false, problem: account.plan === "free" ? `You've used your ${account.videos} free videos this month. Pick a plan to keep clipping.` : "You've clipped all the videos your plan gives this month. It resets on the 1st.", upgrade: account.plan !== "pro" });

  // `place` looks from one named part of the world only (used to find out which ones a video site accepts).
  const only = typeof body.place === "string" && ALL_PLACES.includes(body.place) ? body.place : undefined;
  const found = await checkLink(url, only);
  if (!found || (!found.ok && !found.error)) return NextResponse.json({ ok: false, unknown: true });
  if (!found.ok) {
    const problem = (found.error ?? "").replace(/PeakCut/g, "DWM Clip").replace(/Upload the video file instead, or use a/, "Try a");
    // YouTube turning our servers away passes by itself, so the page offers to look again.
    return NextResponse.json({ ok: false, problem, again: found.refused === true, ...(only ? { where: `${found.where?.colo ?? ""} ${found.where?.country ?? ""}`.trim() } : {}) }, { headers: { "cache-control": "no-store" } });
  }
  const thumb = typeof found.thumb === "string" && /^https:\/\/i\.ytimg\.com\//.test(found.thumb) ? found.thumb : "";
  return NextResponse.json(
    { ok: true, title: String(found.title ?? "").slice(0, 200), uploader: String(found.uploader ?? "").slice(0, 120), seconds: Math.max(0, Math.round(Number(found.seconds) || 0)), live: found.live === true, thumb, place: found.place, planSeconds: account.maxHours * 3600, ...(only ? { where: `${found.where?.colo ?? ""} ${found.where?.country ?? ""}`.trim() } : {}) },
    { headers: { "cache-control": "no-store" } },
  );
}
