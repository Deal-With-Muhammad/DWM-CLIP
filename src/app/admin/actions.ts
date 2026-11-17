"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { GB } from "@/lib/plans";
import { logAdmin } from "@/lib/server/auth-helpers";
import { run } from "@/lib/server/db";
import { clientIp } from "@/lib/server/http";
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
