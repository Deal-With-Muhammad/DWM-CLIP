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
  // The AI gave no answer: say so, with the service's own reason, in words about this site (the engine's name
  // things only its own dashboard has). This matters more than the note about the webcam, so it is kept.
  const noAi = note.includes("The AI was unavailable") || (typeof b.ai_error === "string" && b.ai_error !== "");
  if (noAi) {
    let why = text(b.ai_error, 240)
      .replace(/^The AI did not answer:\s*/, "")
      .replace(/PeakCut/g, "DWM Clip")
      .replace(/Open Settings, AI, press Find models and pick one from the list\./, "Choose another model in Settings.")
      .replace(/Paste a working key under Settings, AI\./, "Paste a working key in Settings.");
    if (/^HTTP \d/.test(why)) why = "";
    // What the service itself replied (which model, which limit), after our own sentence.
    const tried = (Array.isArray(b.ai_said) ? b.ai_said : []) as { model?: unknown; error?: unknown }[];
    const message = (raw: unknown) => {
      const s = text(raw, 400);
      return ((s.match(/"message":\s*"((?:[^"\\]|\\.){4,170})/)?.[1] ?? s.replace(/^HTTP \d+\s*/, "").slice(0, 170)).replace(/\\n/g, " ").replace(/\\"/g, '"')).trim();
    };
    const said = tried.length ? ` ${text(tried[0].model, 60)}: ${message(tried[0].error)}` : "";
    note = `The AI didn't answer, so the loudest moments were picked, without headings or titles. ${said ? `The service said about${said}` : why || "Check your AI key and model in Settings."}`.slice(0, 480);
    console.error("ai gave no answer", id, JSON.stringify(tried).slice(0, 1500));
  } else if (b.facecam === false && status !== "error") note = "This video has no streamer webcam, so the game fills the screen.";
  if (b.storage_full === true) note = "Your storage filled up, so the rest of the clips weren't saved.";
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
