import { NextResponse } from "next/server";

import { run } from "@/lib/server/db";
import { checkJobToken } from "@/lib/server/engine";

// The clip engine says a changed clip is finished (its new files have already arrived), or why it couldn't be made.
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const jobId = q.get("job") ?? "";
  if (!checkJobToken(jobId, req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { ok?: unknown; error?: unknown };
  let error = b.ok === true ? null : typeof b.error === "string" && b.error ? b.error.slice(0, 300) : "The change couldn't be made. Please try again.";
  if (error) error = error.replace(/PeakCut/g, "DWM Clip");
  await run("update clips set status = 'ready', error = ? where job_id = ? and n = ?", error, jobId, q.get("clip") ?? "");
  return NextResponse.json({ ok: true });
}
