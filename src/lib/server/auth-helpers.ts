import "server-only";

import { batch, nowIso, run, stmt } from "@/lib/server/db";

/** A same-site path to continue to after signing in; anything else falls back to the app. */
export const safeNext = (next: unknown) => (typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/app");

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Records an admin sign-in or action. Never throws. */
export async function logAdmin(email: string, action: string, detail?: string, ip?: string) {
  try {
    await run("insert into admin_log (at, email, action, detail, ip) values (?, ?, ?, ?, ?)", nowIso(), email, action, detail ?? null, ip ?? null);
  } catch {}
}

const hitStatement = (key: string, windowSeconds: number) => {
  const now = nowIso();
  const reset = new Date(Date.now() + windowSeconds * 1000).toISOString();
  return stmt(
    `insert into rate_limits (key, n, reset_at) values (?1, 1, ?3)
     on conflict (key) do update set n = case when reset_at < ?2 then 1 else n + 1 end, reset_at = case when reset_at < ?2 then ?3 else reset_at end
     returning n`,
    key,
    now,
    reset,
  );
};

/** Adds one to several rate-limit counters at once and returns them, in order. */
export async function hits(list: [key: string, windowSeconds: number][]): Promise<number[]> {
  const statements = list.map(([k, w]) => hitStatement(k, w));
  // Now and then, clear out counters that ended over a day ago.
  if (Math.random() < 0.01) statements.push(stmt("delete from rate_limits where reset_at < ?", new Date(Date.now() - 86_400_000).toISOString()));
  const results = await batch(statements);
  return list.map((_, i) => Number(results[i].results[0]?.n));
}

/** Adds one to a rate-limit counter that resets after `windowSeconds`, and returns it. */
export async function hit(key: string, windowSeconds: number): Promise<number> {
  return (await hits([[key, windowSeconds]]))[0];
}
