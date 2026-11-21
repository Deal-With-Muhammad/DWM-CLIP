import { NextResponse } from "next/server";

import { settle } from "@/lib/server/budget";
import { first, nowIso, run } from "@/lib/server/db";
import { hoursWord, moment } from "@/lib/link";
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
  // Which part of the world the engine's container is in, for working out who the video sites turn away.
  if (typeof b.where === "string" && b.where) console.log("engine at", id, b.where);
  // Clips added at the end to make up the number asked for, and the clips that came out in all.
  const topped = Math.round(num(b.topped));
  const made = Math.round(num(b.found)) - failed;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("#", String(n)));
  let note = text(b.note, 300);
  // "Follow streamer" was asked for, and some clips (or all of them) have no face to follow: they were made
  // the ordinary way, and the member is told which it was.
  const lost = Math.round(num(b.not_followed));
  const noFace =
    lost > 0 && status !== "error"
      ? Math.round(num(b.followed)) === 0
        ? `The streamer's face wasn't found in ${plural(lost, "this clip", "these clips")}, so the picture fills the screen.`
        : `The streamer's face wasn't found in ${plural(lost, "one clip", "# clips")}, so the picture fills the screen in ${lost === 1 ? "that one" : "those"}.`
      : "";
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
    if (noFace) note += ` ${noFace}`;
    console.error("ai gave no answer", id, JSON.stringify(tried).slice(0, 1500));
  } else {
    const parts: string[] = [];
    // A stream that was on air when it was clipped: say how much of it the clips were picked from.
    if (b.live === true && status !== "error") {
      const hours = num(b.live_hours);
      const last = hours >= 1 ? `${hours === 1 ? "hour" : `${Math.round(hours)} hours`}` : `${Math.round(hours * 60)} minutes`;
      parts.push(b.live_whole === true ? "This stream was live, so the clips come from what had been broadcast so far." : `This stream was live. The clips come from its last ${last}, the most your plan takes.`);
    }
    // A video longer than the plan takes at once: which stretch of it the clips come from.
    if (b.part === true && status !== "error") {
      const hours = num(b.part_hours);
      parts.push(`This video is longer than your plan takes at once, so the clips come from the ${hoursWord(hours)} starting at ${moment(num(b.part_from))}.`);
    }
    if (b.facecam === false && status !== "error") parts.push("There is no streamer webcam in it, so the game fills the screen.");
    if (noFace) parts.push(noFace);
    const skipped = Math.round(num(b.ai_skipped));
    if (status === "done" && b.quiet === true && made > 0) {
      parts.push(`Nobody talks in this video, so ${plural(made, "the clip is its loudest moment", "the clips are its loudest moments")}.`);
    } else if (status === "done" && topped > 0) {
      // The AI chose fewer moments than were asked for (it is told to skip weak ones), or its service was too
      // busy to read every part. The rest were made from the liveliest stretches, so the number asked for is there.
      const why = skipped > 0 ? "The AI service was too busy to read all of it" : made - topped <= 0 ? "The AI found no moment it rated" : `The AI picked only ${plural(made - topped, "one moment", "# moments")}`;
      parts.push(`${why}, so ${plural(topped, "one clip comes", "# clips come")} from the liveliest parts of the video instead.`);
    } else if (skipped > 0 && status === "done") {
      // Parts of a long video the AI service never answered for (a busy or rate-limited key).
      parts.push(`The AI service was too busy to look at ${skipped === 1 ? "one part" : `${skipped} parts`} of it, so ${skipped === 1 ? "that part has" : "those have"} no clips.`);
    }
    if (status === "done" && b.no_room === true && made > 0 && made < Math.round(num(b.asked))) parts.push(`It only has room for ${plural(made, "one clip", "# clips")} of this length.`);
    if (parts.length) note = parts.join(" ");
  }
  if (b.storage_full === true) note = "Your storage filled up, so the rest of the clips weren't saved.";
  let error = status === "error" ? text(b.error, 500) || "Something went wrong with this video." : null;
  // The engine's messages name the tool it's built on; members only know this site.
  if (error) error = error.replace(/PeakCut/g, "DWM Clip").replace(/Upload the video file instead, or use a/, "Try a");
  // A live channel link is swapped for the link of that broadcast's recording, which still works once the stream ends.
  const source = text(b.source_url, 300);
  if (/^https:\/\/(www\.)?(twitch\.tv\/videos\/\d+|kick\.com\/[A-Za-z0-9_-]+\/videos\/[0-9a-f-]{36})$/.test(source)) await run("update jobs set url = ? where id = ? and url != ?", source, id, source);
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
  // The video has ended: its container time goes into the spending ledger (lib/server/budget.ts).
  if (status !== "running") await settle(id).catch((e) => console.error("settle", id, e));
  return NextResponse.json({ ok: true });
}
