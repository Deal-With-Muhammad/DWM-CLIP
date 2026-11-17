import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { accountOf, month } from "@/lib/server/account";
import { batch, env, first, nowIso, stmt } from "@/lib/server/db";
import { checkJobToken } from "@/lib/server/engine";
import { clipKeys } from "@/lib/server/library";
import type { User } from "@/lib/server/session";

// The clip engine sends each finished clip here: first the cover picture, then the video with its
// title and tags. 413 means the member's storage is full, and the engine stops sending.

const MAX_BYTES = 95 * 1024 * 1024; // Cloudflare turns away bigger request bodies

/** R2 needs to know a stream's length up front; on Workers FixedLengthStream gives it that without holding the file in memory. */
async function bodyOf(req: Request, length: number) {
  const Fixed = (globalThis as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
  if (Fixed && req.body) {
    const s = new Fixed(length);
    void req.body.pipeTo(s.writable).catch(() => {});
    return s.readable;
  }
  return await req.arrayBuffer();
}

export async function PUT(req: Request) {
  const q = new URL(req.url).searchParams;
  const jobId = q.get("job") ?? "";
  const n = q.get("clip") ?? "";
  const part = q.get("part");
  if (!checkJobToken(jobId, req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^clip\d{2,3}$/.test(n) || (part !== "cover" && part !== "video")) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const length = Number(req.headers.get("content-length"));
  if (!Number.isInteger(length) || length <= 0 || length > MAX_BYTES) return NextResponse.json({ error: "bad size" }, { status: 400 });

  const job = await first<{ user_id: string }>("select user_id from jobs where id = ?", jobId);
  if (!job) return NextResponse.json({ error: "gone" }, { status: 410 });
  const keys = clipKeys(job.user_id, jobId, n);

  if (part === "cover") {
    await env().MEDIA.put(keys.cover, (await bodyOf(req, length)) as never, { httpMetadata: { contentType: "image/jpeg" } });
    return NextResponse.json({ ok: true });
  }

  const user = await first<User>("select id, email, created_at, last_sign_in_at, plan_override, bonus_bytes, disabled from users where id = ?", job.user_id);
  if (!user) return NextResponse.json({ error: "gone" }, { status: 410 });
  const account = await accountOf(user);
  if (account.clipsLeft <= 0 || account.used + length > account.storage) {
    await env().MEDIA.delete(keys.cover);
    return NextResponse.json({ error: "storage_full" }, { status: 413 });
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(Buffer.from(req.headers.get("x-clip-meta") ?? "", "base64url").toString("utf8"));
  } catch {}
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const tags = Array.isArray(meta.hashtags) ? meta.hashtags.filter((t): t is string => typeof t === "string").slice(0, 10) : [];

  await env().MEDIA.put(keys.video, (await bodyOf(req, length)) as never, { httpMetadata: { contentType: "video/mp4" } });
  const cover = await env().MEDIA.head(keys.cover);
  const at = nowIso();
  await batch([
    stmt(
      `insert into clips (id, job_id, user_id, n, title, hook, description, hashtags, score, category, start_s, end_s, bytes, video_key, cover_key, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (job_id, n) do update set bytes = excluded.bytes, title = excluded.title, hook = excluded.hook`,
      randomUUID(),
      jobId,
      job.user_id,
      n,
      text(meta.title, 200),
      text(meta.hook, 80),
      text(meta.description, 400),
      JSON.stringify(tags),
      Math.round(num(meta.score)),
      text(meta.category, 20) || "other",
      num(meta.start),
      num(meta.end),
      length + (cover?.size ?? 0),
      keys.video,
      cover ? keys.cover : null,
      at,
    ),
    stmt("insert into usage (user_id, month, clips) values (?, ?, 1) on conflict (user_id, month) do update set clips = clips + 1", job.user_id, month()),
    stmt("update jobs set updated_at = ? where id = ?", at, jobId),
  ]);
  return NextResponse.json({ ok: true });
}
