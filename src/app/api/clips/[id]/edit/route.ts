import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { cleanLook } from "@/lib/look";
import { ENGINE_LAYOUT, LAYOUTS, STYLES } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { hit } from "@/lib/server/auth-helpers";
import { env, first, nowIso, run } from "@/lib/server/db";
import { engineReady, startEdit } from "@/lib/server/engine";
import { fail, siteOrigin } from "@/lib/server/http";
import { currentUser } from "@/lib/server/session";

type Row = { id: string; job_id: string; n: string; title: string; description: string; hook: string; start_s: number; end_s: number; style: string; layout: string; captions: number; look: string | null; data_key: string | null; status: string; url: string };

// Changes a clip. The title and description are saved straight away. A change to how the clip looks
// (hook, captions, layout, where it starts and ends) sends it back to the engine, which makes a new version.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const { id } = await params;
  const clip = await first<Row>(
    "select c.id, c.job_id, c.n, c.title, c.description, c.hook, c.start_s, c.end_s, c.style, c.layout, c.captions, c.look, c.data_key, c.status, j.url from clips c join jobs j on j.id = c.job_id where c.id = ? and c.user_id = ?",
    id,
    user.id,
  );
  if (!clip) return fail(404, "That clip isn't here any more.");
  if (clip.status === "updating") return fail(409, "This clip is already being updated. Give it a minute.");
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, max) : fallback);
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

  const title = str(b.title, 200, clip.title);
  const description = str(b.description, 400, clip.description);
  if (title !== clip.title || description !== clip.description) await run("update clips set title = ?, description = ? where id = ?", title, description, id);

  const next = {
    hook: str(b.hook, 60, clip.hook).toUpperCase(),
    style: b.style === "custom" || STYLES.some((s) => s.id === b.style) ? (b.style as string) : clip.style,
    layout: LAYOUTS.some((l) => l.id === b.layout) ? ENGINE_LAYOUT[b.layout as string] : clip.layout,
    captions: typeof b.captions === "boolean" ? b.captions : Boolean(clip.captions),
    start: Math.max(0, Math.round(num(b.start, clip.start_s) * 100) / 100),
    end: Math.round(num(b.end, clip.end_s) * 100) / 100,
  };
  // The member's own caption look only counts when "Custom" is the chosen style.
  const look = next.style === "custom" ? cleanLook(b.look ?? clip.look) : null;
  const sameLook = next.style !== "custom" || JSON.stringify(look) === JSON.stringify(cleanLook(clip.look));
  const same = sameLook && next.hook === clip.hook && next.style === clip.style && next.layout === clip.layout && next.captions === Boolean(clip.captions) && next.start === clip.start_s && next.end === clip.end_s;
  if (same) return NextResponse.json({ ok: true, remaking: false });

  if (next.end - next.start < 5 || next.end - next.start > 120) return fail(400, "A clip can be 5 seconds to 2 minutes long.");
  // Changes may move a clip by up to 8 seconds either way: that's how much of the video is kept around it.
  if (!clip.data_key) return fail(409, "This clip was made before clips could be changed. Make it again from the video link.");
  if (!engineReady()) return fail(503, "Clips can't be changed right now. Please try again soon.");
  if ((await hit(`clip:edit:${user.id}`, 3600)) > 30) return fail(429, "That's a lot of changes in an hour. Try again a little later.");

  const saved = await env().MEDIA.get(clip.data_key);
  let data: { words?: unknown; fixed_words?: unknown; fixed_for?: unknown; facecam?: unknown; facecam_dims?: unknown; highlight_words?: unknown; quality?: unknown; beats?: unknown; tighten?: unknown; live?: unknown; source?: unknown; streamer?: unknown } = {};
  try {
    data = saved ? JSON.parse(await saved.text()) : {};
  } catch {}
  if (!saved) return fail(409, "This clip can't be changed any more. Make it again from the video link.");

  const account = await accountOf(user);
  // Remaking a clip runs the engine too. While the Free plan is closed, that is for members who have paid.
  if (account.freeWaits && account.hoursBought <= 0) return fail(402, `${account.freeWaits} Changing a clip needs a plan or video hours.`, { upgrade: true });
  const at = nowIso();
  await run("update clips set status = 'updating', error = null, edited_at = ? where id = ?", at, id);
  try {
    await startEdit({
      id: randomUUID(),
      mode: "edit",
      job: clip.job_id,
      url: clip.url,
      // A clip keeps its later headings and its cuts when it is changed, and (in the "follow" layout) the place
      // its streamer sits. One made from a live stream is fetched from that stream again while it is still on air.
      beats: Array.isArray(data.beats) ? data.beats.slice(0, 3) : [],
      tighten: data.tighten === true,
      live: data.live === true,
      callback: `${siteOrigin(req)}/api/engine`,
      quality: account.quality,
      clip: { n: clip.n, ...next, style: look ? "bounce" : next.style === "custom" ? "bounce" : next.style, look, highlight_words: data.highlight_words ?? [], facecam: data.facecam ?? null, facecam_dims: data.facecam_dims ?? null, streamer: data.streamer ?? null },
      words: data.words ?? [],
      fixed_words: data.fixed_words ?? [],
      fixed_for: data.fixed_for ?? null,
    });
  } catch (e) {
    console.error("engine edit", e);
    await run("update clips set status = 'ready' where id = ?", id);
    const busy = e instanceof Error && e.message === "busy";
    return fail(503, busy ? "Lots of videos are being clipped right now. Try again in a minute." : "Couldn't start the change. Please try again.");
  }
  return NextResponse.json({ ok: true, remaking: true });
}
