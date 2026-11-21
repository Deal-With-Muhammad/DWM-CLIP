import "server-only";

import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { cache } from "react";

import { all, batch, first, nowIso, run, stmt } from "@/lib/server/db";
import { setting } from "@/lib/server/settings";

// Members sign in with a 6-digit code (or link) sent by email; there are no
// passwords. The session is a random token in an httpOnly cookie, and only its
// hash is stored, so a copy of the database can't be used to sign in.

export type User = { id: string; email: string; created_at: string; last_sign_in_at: string | null; plan_override: string | null; bonus_bytes: number; disabled: number };

const COOKIE = "dwm_clip_session";
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;

export { clean } from "@/lib/server/settings";

/** Signs cookies and codes. Falls back to a fixed key in development only. */
export function secretKey() {
  const own = setting("SESSION_SECRET");
  if (own) return own;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  return "dev-only-secret";
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const keyed = (s: string) => createHmac("sha256", secretKey()).update(s).digest("hex");
export const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The signed-in user. Read once per request; every page and route goes through here. */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return first<User>(
    "select u.id, u.email, u.created_at, u.last_sign_in_at, u.plan_override, u.bonus_bytes, u.disabled from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ? and u.disabled = 0",
    sha256(token),
    nowIso(),
  );
});

/**
 * Makes a new code and link for this email. Earlier ones that haven't expired keep working: an email can be slow,
 * and a member who asks twice often types the code from the first one.
 */
export async function issueCode(email: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const link = randomBytes(24).toString("base64url");
  await batch([
    stmt("delete from login_tokens where email = ? and expires_at <= ?", email, nowIso()),
    stmt(
      "insert into login_tokens (email, code_hash, link_hash, tries, expires_at) values (?, ?, ?, 0, ?)",
      email,
      keyed(`code:${email}:${code}`),
      keyed(`link:${email}:${link}`),
      new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    ),
  ]);
  return { code, link };
}

type Waiting = { id: number; code_hash: string; link_hash: string };

/**
 * Checks a code or link against every one still waiting for this email. A typed code works once and only gets a
 * few wrong tries. The link keeps working until it expires: email apps open links to scan them, and members tap
 * the link in one browser and then type the code in another, and both used to end in "expired or already used".
 */
export async function checkCode(email: string, proof: { code: string } | { link: string }) {
  const rows = await all<Waiting>("select id, code_hash, link_hash from login_tokens where email = ? and expires_at > ? and tries < ?", email, nowIso(), CODE_TRIES);
  if ("link" in proof) return rows.some((r) => same(r.link_hash, keyed(`link:${email}:${proof.link}`)));
  const match = rows.find((r) => same(r.code_hash, keyed(`code:${email}:${proof.code}`)));
  if (match) await run("delete from login_tokens where id = ?", match.id);
  else if (rows.length) await run("update login_tokens set tries = tries + 1 where email = ? and expires_at > ?", email, nowIso());
  return Boolean(match);
}

/** Signs this email in, making the account the first time, and sets the cookie. */
export async function startSession(email: string): Promise<User> {
  const at = nowIso();
  const user = await first<User>(
    `insert into users (id, email, created_at, last_sign_in_at) values (?, ?, ?, ?)
     on conflict (email) do update set last_sign_in_at = excluded.last_sign_in_at
     returning id, email, created_at, last_sign_in_at, plan_override, bonus_bytes, disabled`,
    randomUUID(),
    email,
    at,
    at,
  );
  if (!user) throw new Error("Couldn't save the account");
  const token = randomBytes(32).toString("base64url");
  await batch([
    stmt("delete from sessions where user_id = ? and expires_at <= ?", user.id, at),
    stmt("insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)", sha256(token), user.id, new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()),
  ]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return user;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await run("delete from sessions where token_hash = ?", sha256(token));
  jar.delete(COOKIE);
}

const admins = () =>
  setting("ADMIN_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isAdminEmail = (email: string | null | undefined) => Boolean(email && admins().includes(email.toLowerCase()));
