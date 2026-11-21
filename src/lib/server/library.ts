import "server-only";

import { cleanLook, type Look } from "@/lib/look";
import { FREE, fromEngineLayout } from "@/lib/plans";
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
  start: number;
  end: number;
  seconds: number;
  bytes: number;
  style: string;
  /** "auto", "crop" or "blur", as the page names them. */
  layout: string;
  captions: boolean;
  /** The member's own caption look, when the style is "custom". */
  look: Look | null;
  /** "updating" while a changed version is being made. */
  status: "ready" | "updating";
  error: string | null;
  /** Whether the clip can be remade (older clips have nothing saved to remake them from). */
  editable: boolean;
  version: number;
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
  focus: string;
  found: number;
  failed: number;
  created_at: string;
  clips: Clip[];
};

type ClipRow = Omit<Clip, "hashtags" | "seconds" | "captions" | "editable" | "start" | "end" | "look"> & { hashtags: string; start_s: number; end_s: number; captions: number; look: string | null; data_key: string | null };

/** A video or an edit the engine went quiet on (it crashed, or was restarted) is closed, so it doesn't spin for ever. */
const STALE_MS = 15 * 60_000;

export async function listJobs(userId: string): Promise<Job[]> {
  const at = nowIso();
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  await Promise.all([
    run(
      "update jobs set status = 'error', stage = 'Stopped', error = 'This video stopped unexpectedly. Please try it again.', finished_at = ?1 where user_id = ?2 and status in ('queued', 'running') and updated_at < ?3",
      at,
      userId,
      stale,
    ),
    run("update clips set status = 'ready', error = 'The change took too long and was stopped. Please try again.' where user_id = ? and status = 'updating' and edited_at < ?", userId, stale),
  ]);
  const [jobs, clips] = await Promise.all([
    all<Omit<Job, "clips">>(
      "select id, url, title, uploader, duration, game, status, stage, progress, error, note, ai_mode, focus, found, failed, created_at from jobs where user_id = ? order by created_at desc limit 60",
      userId,
    ),
    all<ClipRow>(
      "select id, job_id, n, title, hook, description, hashtags, score, category, start_s, end_s, bytes, style, layout, captions, look, status, error, data_key, version, created_at from clips where user_id = ? order by n",
      userId,
    ),
  ]);
  const by = new Map<string, Clip[]>();
  for (const c of clips) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(c.hashtags);
    } catch {}
    const { start_s, end_s, data_key, ...rest } = c;
    const clip: Clip = { ...rest, hashtags: tags, start: start_s, end: end_s, seconds: Math.max(0, end_s - start_s), layout: fromEngineLayout(c.layout), captions: Boolean(c.captions), look: cleanLook(c.look), editable: Boolean(data_key) };
    (by.get(c.job_id) ?? by.set(c.job_id, []).get(c.job_id)!).push(clip);
  }
  return jobs.map((j) => ({ ...j, clips: by.get(j.id) ?? [] }));
}

/** Where a clip's files live in the bucket. `data` is what's needed to make the clip again. */
export const clipKeys = (userId: string, jobId: string, n: string) => ({ video: `${userId}/${jobId}/${n}.mp4`, cover: `${userId}/${jobId}/${n}.jpg`, data: `${userId}/${jobId}/${n}.json` });

export async function removeFiles(keys: (string | null | undefined)[]) {
  const list = keys.filter((k): k is string => Boolean(k));
  for (let i = 0; i < list.length; i += 1000) await env().MEDIA.delete(list.slice(i, i + 1000));
}

/**
 * Deletes Free-plan clips older than the plan keeps them (FREE.keepDays), oldest first, files and rows. Run once a
 * day by the Worker's timer (custom-worker.ts). The video's row stays, so it still counts towards the month.
 *
 * Only members who have never paid are touched: anyone with a plan given by the admin, extra storage, bought video
 * hours, or a subscription that is running or changed within the same number of days keeps everything, so a
 * payment that fails for a few days never costs a member their clips.
 */
export async function sweepFreeClips({ days = FREE.keepDays, max = 400, dry = false } = {}) {
  if (!(days > 0)) return { clips: 0, bytes: 0, dry };
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all<{ id: string; job_id: string; video_key: string; cover_key: string | null; data_key: string | null; bytes: number }>(
    `select c.id, c.job_id, c.video_key, c.cover_key, c.data_key, c.bytes from clips c join users u on u.id = c.user_id
      where c.created_at < ?1 and c.status != 'updating' and u.plan_override is null and u.bonus_bytes = 0
        and not exists (select 1 from subscriptions s where s.user_id = c.user_id
          and (s.status in ('active', 'trialing', 'on_trial', 'past_due') or s.ends_at > ?1 or s.updated_at > ?1))
        and not exists (select 1 from hour_packs h where h.user_id = c.user_id)
      order by c.created_at limit ?2`,
    cutoff,
    max,
  );
  const bytes = rows.reduce((n, r) => n + (r.bytes || 0), 0);
  if (dry || !rows.length) return { clips: rows.length, bytes, dry };
  // Files first: if the rows fail to go, the next run finds them again and deleting a missing file is harmless.
  await removeFiles(rows.flatMap((r) => [r.video_key, r.cover_key, r.data_key]));
  const note = `These clips were deleted after ${days} days, as the Free plan keeps them that long.`;
  for (let i = 0; i < rows.length; i += 50) {
    const part = rows.slice(i, i + 50);
    const marks = part.map(() => "?").join(", ");
    await run(`delete from clips where id in (${marks})`, ...part.map((r) => r.id));
    const jobs = [...new Set(part.map((r) => r.job_id))];
    // A video left with no clips says why, instead of "no moment stood out".
    await run(`update jobs set note = ? where id in (${jobs.map(() => "?").join(", ")}) and not exists (select 1 from clips where clips.job_id = jobs.id)`, note, ...jobs);
  }
  return { clips: rows.length, bytes, dry };
}

/** Sign-in codes and rate-limit counters that ended over a day ago. */
export async function sweepExpired() {
  const old = new Date(Date.now() - 86_400_000).toISOString();
  await run("delete from login_tokens where expires_at < ?", old);
  await run("delete from rate_limits where reset_at < ?", old);
}
