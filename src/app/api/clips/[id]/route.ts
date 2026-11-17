import { NextResponse } from "next/server";

import { first, run } from "@/lib/server/db";
import { fail } from "@/lib/server/http";
import { removeFiles } from "@/lib/server/library";
import { currentUser } from "@/lib/server/session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const { id } = await params;
  const clip = await first<{ video_key: string; cover_key: string | null; data_key: string | null }>("select video_key, cover_key, data_key from clips where id = ? and user_id = ?", id, user.id);
  if (!clip) return fail(404, "That clip isn't here any more.");
  await removeFiles([clip.video_key, clip.cover_key, clip.data_key]);
  await run("delete from clips where id = ?", id);
  return NextResponse.json({ ok: true });
}
