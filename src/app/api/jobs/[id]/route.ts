import { NextResponse } from "next/server";

import { settle } from "@/lib/server/budget";
import { all, first, run } from "@/lib/server/db";
import { fail } from "@/lib/server/http";
import { removeFiles } from "@/lib/server/library";
import { currentUser } from "@/lib/server/session";

// Deletes a video and every clip made from it. A video still being worked on stops at its next progress message.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  const { id } = await params;
  const job = await first("select id from jobs where id = ? and user_id = ?", id, user.id);
  if (!job) return fail(404, "That video isn't here any more.");
  const clips = await all<{ video_key: string; cover_key: string | null; data_key: string | null }>("select video_key, cover_key, data_key from clips where job_id = ?", id);
  await removeFiles(clips.flatMap((c) => [c.video_key, c.cover_key, c.data_key]));
  // A video deleted while it runs has still used its container until now.
  await settle(id).catch((e) => console.error("settle", id, e));
  await run("delete from jobs where id = ?", id);
  return NextResponse.json({ ok: true });
}
