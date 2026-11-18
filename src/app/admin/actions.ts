"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { GB } from "@/lib/plans";
import { logAdmin } from "@/lib/server/auth-helpers";
import { first, run } from "@/lib/server/db";
import { clientIp } from "@/lib/server/http";
import { removeFiles } from "@/lib/server/library";
import { currentUser, isAdminEmail } from "@/lib/server/session";

async function admin() {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email)) throw new Error("Not allowed");
  return user;
}

/** Gives a member Pro without a payment, or takes it away again. */
export async function setPlan(form: FormData) {
  const me = await admin();
  const id = String(form.get("id") ?? "");
  const plan = form.get("plan") === "pro" ? "pro" : null;
  await run("update users set plan_override = ? where id = ?", plan, id);
  await logAdmin(me.email, plan ? "give-pro" : "remove-pro", id, clientIp(await headers()));
  revalidatePath("/admin");
}

/** Adds extra storage to a member (or removes it). */
export async function setBonus(form: FormData) {
  const me = await admin();
  const id = String(form.get("id") ?? "");
  const gb = Math.max(0, Math.min(1000, Number(form.get("gb")) || 0));
  await run("update users set bonus_bytes = ? where id = ?", gb * GB, id);
  await logAdmin(me.email, "bonus-storage", `${id}: ${gb} GB`, clientIp(await headers()));
  revalidatePath("/admin");
}

/** Removes one clip of any member: its files and its row. The member's count of clips made stays as it is. */
export async function deleteClip(form: FormData) {
  const me = await admin();
  const id = String(form.get("id") ?? "");
  const clip = await first<{ user_id: string; title: string; video_key: string; cover_key: string | null; data_key: string | null }>("select user_id, title, video_key, cover_key, data_key from clips where id = ?", id);
  if (clip) {
    await removeFiles([clip.video_key, clip.cover_key, clip.data_key]);
    await run("delete from clips where id = ?", id);
    await logAdmin(me.email, "delete-clip", `${id} of ${clip.user_id}: ${clip.title}`.slice(0, 200), clientIp(await headers()));
  }
  revalidatePath("/admin");
}
