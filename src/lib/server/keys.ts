import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { PROVIDERS } from "@/lib/plans";
import { first, nowIso, run } from "@/lib/server/db";
import { secretKey } from "@/lib/server/session";

// A member's own AI key. It is encrypted before it is stored (AES-256-GCM, with a key
// made from SESSION_SECRET), sent only to the clip engine for their own videos, and
// never sent back to the browser: the page only sees which service and the last 4 characters.

const key = () => createHash("sha256").update(`ai-key:${secretKey()}`).digest();

function lock(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

function unlock(stored: string) {
  const raw = Buffer.from(stored, "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

type Row = { provider: string; model: string; key_enc: string; updated_at: string };

export const isProvider = (id: unknown): id is string => PROVIDERS.some((p) => p.id === id);

export async function saveKey(userId: string, provider: string, model: string, apiKey: string) {
  await run(
    `insert into ai_keys (user_id, provider, model, key_enc, updated_at) values (?, ?, ?, ?, ?)
     on conflict (user_id) do update set provider = excluded.provider, model = excluded.model, key_enc = excluded.key_enc, updated_at = excluded.updated_at`,
    userId,
    provider,
    model,
    lock(apiKey),
    nowIso(),
  );
}

export const removeKey = (userId: string) => run("delete from ai_keys where user_id = ?", userId);

/** For the settings page: never the key itself. */
export async function keyInfo(userId: string) {
  const r = await first<Row>("select provider, model, key_enc, updated_at from ai_keys where user_id = ?", userId);
  if (!r) return null;
  let tail = "";
  try {
    tail = unlock(r.key_enc).slice(-4);
  } catch {}
  return { provider: r.provider, model: r.model, tail, updatedAt: r.updated_at };
}

/** For the clip engine only. */
export async function keyFor(userId: string) {
  const r = await first<Row>("select provider, model, key_enc, updated_at from ai_keys where user_id = ?", userId);
  if (!r) return null;
  try {
    return { provider: r.provider, model: r.model, key: unlock(r.key_enc) };
  } catch {
    return null; // SESSION_SECRET changed: the member saves the key again
  }
}
