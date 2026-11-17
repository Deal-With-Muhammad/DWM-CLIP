import { env } from "@/lib/server/db";

// The homepage film (public/hero.mp4), served so that a browser can ask for part of it.
// iPhones only play a video whose server answers such "range" requests, and plain files on
// Cloudflare's asset server don't. The film is small (under 1 MB), so it is kept in memory.

let film: ArrayBuffer | null = null;

async function load(req: Request) {
  if (film) return film;
  try {
    const res = await env().ASSETS.fetch(new URL("/hero.mp4", req.url).toString());
    if (res.ok) film = await res.arrayBuffer();
  } catch {
    // In `next dev` there is no asset server: the caller falls back to the plain file.
  }
  return film;
}

export async function GET(req: Request) {
  const bytes = await load(req);
  if (!bytes) return Response.redirect(new URL("/hero.mp4", req.url), 302);
  const size = bytes.byteLength;
  const headers = new Headers({ "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=86400" });

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range || (!range[1] && !range[2])) {
    headers.set("content-length", String(size));
    return new Response(bytes, { headers });
  }
  let start = 0;
  let end = size - 1;
  if (range[1]) {
    start = Number(range[1]);
    if (range[2]) end = Math.min(end, Number(range[2]));
  } else start = Math.max(0, size - Number(range[2]));
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
