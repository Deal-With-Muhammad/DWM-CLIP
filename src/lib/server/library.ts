import "server-only";

import { all, env, nowIso, run } from "@/lib/server/db";

// A member's videos and the clips made from them.

export type Clip = {
  id: string;
  job_id: string;
  n: string;
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  score: number;
  category: string;
  seconds: number;
  bytes: number;
  created_at: string;
};

export type Job = {
  id: string;
  url: string;
  title: string;
  uploader: string;
  duration: number;
  game: string;
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  error: string | null;
  note: string;
  ai_mode: string;
  found: number;
  failed: number;
  created_at: string;
  clips: Clip[];
};

type ClipRow = Omit<Clip, "hashtags" | "seconds"> & { hashtags: string; start_s: number; end_s: number };

/** A video the engine went quiet on (it crashed, or was restarted) is closed, so it doesn't spin for ever. */
const STALE_MS = 15 * 60_000;

export async function listJobs(userId: string): Promise<Job[]> {
  await run(
    "update jobs set status = 'error', stage = 'Stopped', error = 'This video stopped unexpectedly. Please try it again.', finished_at = ?1 where user_id = ?2 and status in ('queued', 'running') and updated_at < ?3",
    nowIso(),
    userId,
    new Date(Date.now() - STALE_MS).toISOString(),
  );
  const [jobs, clips] = await Promise.all([
    all<Omit<Job, "clips">>(
      "select id, url, title, uploader, duration, game, status, stage, progress, error, note, ai_mode, found, failed, created_at from jobs where user_id = ? order by created_at desc limit 60",
      userId,
    ),
    all<ClipRow>("select id, job_id, n, title, hook, description, hashtags, score, category, start_s, end_s, bytes, created_at from clips where user_id = ? order by n", userId),
  ]);
  const by = new Map<string, Clip[]>();
  for (const c of clips) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(c.hashtags);
    } catch {}
    const { start_s, end_s, ...rest } = c;
    (by.get(c.job_id) ?? by.set(c.job_id, []).get(c.job_id)!).push({ ...rest, hashtags: tags, seconds: Math.max(0, end_s - start_s) });
  }
  return jobs.map((j) => ({ ...j, clips: by.get(j.id) ?? [] }));
}

/** Where a clip's files live in the bucket. */
export const clipKeys = (userId: string, jobId: string, n: string) => ({ video: `${userId}/${jobId}/${n}.mp4`, cover: `${userId}/${jobId}/${n}.jpg` });

export async function removeFiles(keys: (string | null | undefined)[]) {
  const list = keys.filter((k): k is string => Boolean(k));
  for (let i = 0; i < list.length; i += 1000) await env().MEDIA.delete(list.slice(i, i + 1000));
}
