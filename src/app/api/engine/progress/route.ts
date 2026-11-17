import { NextResponse } from "next/server";

import { first, nowIso, run } from "@/lib/server/db";
import { checkJobToken } from "@/lib/server/engine";

// The clip engine reports how a video is going. 410 tells it the video was deleted, so it stops.
export async function POST(req: Request) {
  const id = new URL(req.url).searchParams.get("job") ?? "";
  if (!checkJobToken(id, req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = await first<{ status: string }>("select status from jobs where id = ?", id);
  if (!job) return NextResponse.json({ error: "gone" }, { status: 410 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const status = b.status === "done" || b.status === "error" ? b.status : "running";
  const at = nowIso();
  const failed = Array.isArray(b.failed) ? b.failed.length : 0;
  let note = text(b.note, 300);
  if (b.facecam === false && status !== "error") note = "This video has no streamer webcam, so the game fills the screen.";
  if (b.storage_full === true) note = "Your storage filled up, so the rest of the clips weren't saved.";
  // The engine's wording for a missing or refused AI key names nothing the member knows.
  note = note.replace("The AI was unavailable, so clips were picked by loudness only.", "The AI couldn't be reached, so the loudest moments were picked and they have no titles. Check your AI key in Settings.");
  let error = status === "error" ? text(b.error, 500) || "Something went wrong with this video." : null;
  // The engine's messages name the tool it's built on; members only know this site.
  if (error) error = error.replace(/PeakCut/g, "DWM Clip").replace(/Upload the video file instead, or use a/, "Try a");
  await run(
    `update jobs set status = ?, stage = ?, progress = ?, title = case when ? != '' then ? else title end, uploader = ?, duration = ?, game = ?,
       error = ?, note = ?, model = coalesce(?, model), tokens = ?, found = ?, failed = ?, facecam = coalesce(?, facecam), updated_at = ?, finished_at = ? where id = ?`,
    status,
    text(b.stage, 120) || "Working",
    Math.max(0, Math.min(1, num(b.progress))),
    text(b.title, 200),
    text(b.title, 200),
    text(b.uploader, 120),
    num(b.duration),
    text(b.game, 60),
    error,
    note,
    text(b.model, 80) || null,
    Math.round(num(b.tokens)),
    Math.round(num(b.found)),
    failed,
    typeof b.facecam === "boolean" ? b.facecam : null,
    at,
    status === "running" ? null : at,
    id,
  );
  return NextResponse.json({ ok: true });
}
