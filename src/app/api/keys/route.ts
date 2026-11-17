import { NextResponse } from "next/server";

import { PROVIDERS } from "@/lib/plans";
import { hit } from "@/lib/server/auth-helpers";
import { fail } from "@/lib/server/http";
import { isProvider, keyInfo, removeKey, saveKey } from "@/lib/server/keys";
import { currentUser } from "@/lib/server/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  return NextResponse.json({ key: await keyInfo(user.id) }, { headers: { "cache-control": "no-store" } });
}

const BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Asks the service for its model list with this key: the cheapest call that proves the key works. */
async function keyWorks(provider: string, key: string): Promise<boolean | null> {
  try {
    const opts = { signal: AbortSignal.timeout(10_000) };
    let res: Response;
    if (provider === "gemini") res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { ...opts, headers: { "x-goog-api-key": key } });
    else if (provider === "anthropic") res = await fetch("https://api.anthropic.com/v1/models?limit=1", { ...opts, headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    else if (provider === "openrouter") res = await fetch(`${BASE.openrouter}/key`, { ...opts, headers: { authorization: `Bearer ${key}` } });
    else res = await fetch(`${BASE[provider]}/models`, { ...opts, headers: { authorization: `Bearer ${key}` } });
    if (res.ok) return true;
    return res.status === 400 || res.status === 401 || res.status === 403 ? false : null;
  } catch {
    return null; // couldn't reach the service: save it anyway, the first video will tell
  }
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  if ((await hit(`clip:key:${user.id}`, 600)) > 12) return fail(429, "Too many tries. Wait a few minutes.");
  const body = (await req.json().catch(() => ({}))) as { provider?: unknown; model?: unknown; key?: unknown };
  if (!isProvider(body.provider)) return fail(400, "Choose an AI service.");
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < 16 || key.length > 400 || /\s/.test(key)) return fail(400, "That key doesn't look right. Paste the whole key.");
  const fallback = PROVIDERS.find((p) => p.id === body.provider)!.model;
  const model = typeof body.model === "string" && /^[\w.:\/-]{2,80}$/.test(body.model.trim()) ? body.model.trim() : fallback;
  const works = await keyWorks(body.provider, key);
  if (works === false) return fail(400, "That service didn't accept the key. Check it and paste it again.");
  await saveKey(user.id, body.provider, model, key);
  return NextResponse.json({ ok: true, checked: works === true, key: await keyInfo(user.id) });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  await removeKey(user.id);
  return NextResponse.json({ ok: true });
}
