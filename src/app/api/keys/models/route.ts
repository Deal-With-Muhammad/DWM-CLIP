import { NextResponse } from "next/server";

import { hit } from "@/lib/server/auth-helpers";
import { fail } from "@/lib/server/http";
import { isProvider, keyFor } from "@/lib/server/keys";
import { currentUser } from "@/lib/server/session";

// The models an AI service offers right now, asked from the service itself with the member's key, so the
// list in Settings is never out of date. OpenRouter's list is public and needs no key.

const BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Models that can't read a transcript and answer in text: pictures, speech, embeddings and the like. */
const NOT_CHAT = /embed|tts|whisper|dall-e|imagen|image|veo|sora|audio|speech|moderation|realtime|transcribe|guard|davinci|babbage|aqa|robotics|computer-use|live/i;
/** The same shape the save route accepts, so every model listed can be saved. */
const SAVEABLE = /^[\w.:\/-]{2,80}$/;

async function listModels(provider: string, key: string): Promise<string[]> {
  const opts = { signal: AbortSignal.timeout(10_000) };
  let ids: string[] = [];
  if (provider === "gemini") {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { ...opts, headers: { "x-goog-api-key": key } });
    if (!res.ok) return [];
    const j = (await res.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    ids = (j.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => String(m.name ?? "").replace(/^models\//, ""));
  } else {
    const headers: Record<string, string> = provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : key ? { authorization: `Bearer ${key}` } : {};
    const res = await fetch(provider === "anthropic" ? "https://api.anthropic.com/v1/models?limit=1000" : `${BASE[provider]}/models`, { ...opts, headers });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { id?: string }[] };
    ids = (j.data ?? []).map((m) => String(m.id ?? ""));
  }
  const good = [...new Set(ids)].filter((id) => SAVEABLE.test(id) && !NOT_CHAT.test(id));
  // Claude's list arrives newest first, which is the useful order; the others have none, so by name.
  return (provider === "anthropic" ? good : good.sort((a, b) => a.localeCompare(b))).slice(0, 800);
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first.");
  if ((await hit(`clip:models:${user.id}`, 600)) > 60) return fail(429, "Too many tries. Wait a few minutes.");
  const body = (await req.json().catch(() => ({}))) as { provider?: unknown; key?: unknown };
  if (!isProvider(body.provider)) return fail(400, "Choose an AI service.");
  // The key being typed, or else the saved one when it belongs to this service.
  let key = typeof body.key === "string" && body.key.trim().length >= 16 && body.key.trim().length <= 400 && !/\s/.test(body.key.trim()) ? body.key.trim() : "";
  if (!key) {
    const saved = await keyFor(user.id);
    if (saved?.provider === body.provider) key = saved.key;
  }
  let models: string[] = [];
  if (key || body.provider === "openrouter") {
    try {
      models = await listModels(body.provider, key);
    } catch {}
  }
  return NextResponse.json({ models }, { headers: { "cache-control": "no-store" } });
}
