import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { setting } from "@/lib/server/settings";

// The clip engine (the engine/ folder) does the video work: it fetches the video,
// finds the moments and renders the clips, then sends progress and files back to
// /api/engine/*. This site only starts jobs there.
//   ENGINE_URL      where the engine listens, e.g. http://127.0.0.1:8080 in development
//   ENGINE_SECRET   shared by both sides

const secret = () => setting("ENGINE_SECRET");

export const engineReady = () => Boolean(setting("ENGINE_URL") && secret());

/** What the engine must send back with every message about this job. */
export const jobToken = (jobId: string) => createHmac("sha256", secret()).update(`job:${jobId}`).digest("hex");

export function checkJobToken(jobId: string, header: string | null) {
  if (!secret() || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const want = Buffer.from(jobToken(jobId));
  return got.length === want.length && timingSafeEqual(got, want);
}

export type EngineJob = {
  id: string;
  url: string;
  callback: string;
  options: { max_clips: number; min_len: number; max_len: number; style: string; layout: string; captions: boolean; quality: number };
  ai: { provider: string; model: string; key: string } | null;
  max_hours: number;
};

export async function startJob(job: EngineJob) {
  const res = await fetch(`${setting("ENGINE_URL").replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret()}` },
    body: JSON.stringify({ ...job, token: jobToken(job.id) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new Error("busy");
  if (!res.ok) throw new Error(`engine answered ${res.status}`);
}
