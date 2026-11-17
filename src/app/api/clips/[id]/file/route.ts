import { env, first } from "@/lib/server/db";
import { fail } from "@/lib/server/http";
import { currentUser } from "@/lib/server/session";

// A clip's video or cover picture, for its owner only. Videos answer range requests, so the player can seek.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const { id } = await params;
  const url = new URL(req.url);
  const cover = url.searchParams.get("part") === "cover";
  const clip = await first<{ video_key: string; cover_key: string | null; title: string; n: string }>("select video_key, cover_key, title, n from clips where id = ? and user_id = ?", id, user.id);
  const key = cover ? clip?.cover_key : clip?.video_key;
  if (!clip || !key) return fail(404, "Not found.");

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const head = await env().MEDIA.head(key);
  if (!head) return fail(404, "Not found.");
  const size = head.size;
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else start = Math.max(0, size - Number(range[2]));
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const partial = Boolean(range) && (start > 0 || end < size - 1);
  const object = await env().MEDIA.get(key, partial ? { range: { offset: start, length: end - start + 1 } } : undefined);
  if (!object) return fail(404, "Not found.");

  const headers = new Headers({
    "content-type": cover ? "image/jpeg" : "video/mp4",
    "content-length": String(end - start + 1),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  });
  if (partial) headers.set("content-range", `bytes ${start}-${end}/${size}`);
  if (url.searchParams.get("download")) {
    const name = (clip.title || clip.n).replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || clip.n;
    headers.set("content-disposition", `attachment; filename="${name}.mp4"`);
  }
  return new Response(object.body as unknown as BodyInit, { status: partial ? 206 : 200, headers });
}
