import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { accountOf, month } from "@/lib/server/account";
import { batch, env, first, nowIso, run, stmt } from "@/lib/server/db";
import { checkJobToken } from "@/lib/server/engine";
import { cleanLook } from "@/lib/look";
import { clipKeys } from "@/lib/server/library";
import type { User } from "@/lib/server/session";

// The clip engine sends each finished clip here: the cover picture, the small file needed to make the
// clip again, then the video with its title and tags. 413 means the member's storage is full, and the
// engine stops sending. With ?edit=1 it is a new version of a clip that already exists.

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
  const edit = q.get("edit") === "1";
  if (!checkJobToken(jobId, req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^clip\d{2,3}$/.test(n) || (part !== "cover" && part !== "video" && part !== "data")) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const job = await first<{ user_id: string }>("select user_id from jobs where id = ?", jobId);
  if (!job) return NextResponse.json({ error: "gone" }, { status: 410 });
  const keys = clipKeys(job.user_id, jobId, n);

  if (part === "data") {
    const text = await req.text();
    if (text.length > 400_000) return NextResponse.json({ error: "bad size" }, { status: 400 });
    await env().MEDIA.put(keys.data, text, { httpMetadata: { contentType: "application/json" } });
    return NextResponse.json({ ok: true });
  }

  const length = Number(req.headers.get("content-length"));
  if (!Number.isInteger(length) || length <= 0 || length > MAX_BYTES) return NextResponse.json({ error: "bad size" }, { status: 400 });

  if (part === "cover") {
    await env().MEDIA.put(keys.cover, (await bodyOf(req, length)) as never, { httpMetadata: { contentType: "image/jpeg" } });
    return NextResponse.json({ ok: true });
  }

  const user = await first<User>("select id, email, created_at, last_sign_in_at, plan_override, bonus_bytes, disabled from users where id = ?", job.user_id);
  if (!user) return NextResponse.json({ error: "gone" }, { status: 410 });
  const account = await accountOf(user);
  const existing = await first<{ id: string; bytes: number }>("select id, bytes from clips where job_id = ? and n = ?", jobId, n);
  if (edit && !existing) return NextResponse.json({ error: "gone" }, { status: 410 });
  // A new clip uses one of the member's clips and must fit in their storage; a new version only has to fit.
  const full = account.used - (existing?.bytes ?? 0) + length > account.storage;
  if (full || (!existing && account.clipsLeft <= 0)) {
    if (!existing) await env().MEDIA.delete([keys.cover, keys.data]);
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
  const [cover, data] = await Promise.all([env().MEDIA.head(keys.cover), env().MEDIA.head(keys.data)]);
  const bytes = length + (cover?.size ?? 0);
  const at = nowIso();
  // The member's own caption look, if they chose one (see lib/look.ts); kept so the editor opens with it.
  const own = cleanLook(meta.look);
  const look = [text(meta.style, 20) || "bounce", text(meta.layout, 20) || "crop", meta.captions === false ? 0 : 1, own ? JSON.stringify(own) : null] as const;

  if (existing) {
    // A new version: the title, description and tags stay as the member has them.
    await run(
      "update clips set hook = ?, start_s = ?, end_s = ?, bytes = ?, style = ?, layout = ?, captions = ?, look = ?, version = version + 1, edited_at = ? where id = ?",
      text(meta.hook, 80),
      num(meta.start),
      num(meta.end),
      bytes,
      ...look,
      at,
      existing.id,
    );
    return NextResponse.json({ ok: true });
  }

  await batch([
    stmt(
      `insert into clips (id, job_id, user_id, n, title, hook, description, hashtags, score, category, start_s, end_s, bytes, video_key, cover_key, data_key, style, layout, captions, look, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      bytes,
      keys.video,
      cover ? keys.cover : null,
      data ? keys.data : null,
      ...look,
      at,
    ),
    stmt("insert into usage (user_id, month, clips) values (?, ?, 1) on conflict (user_id, month) do update set clips = clips + 1", job.user_id, month()),
    stmt("update jobs set updated_at = ? where id = ?", at, jobId),
  ]);
  return NextResponse.json({ ok: true });
}
