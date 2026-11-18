import "server-only";

const BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

/**
 * One tiny question to the chosen model. A key can be fine while the model is not: retired for new keys, not on
 * the free tier, misspelt, or out of credit. Then every video would quietly fall back to "the loudest moments",
 * so the key isn't saved until the model answers. null: couldn't tell (the service is down), save it anyway.
 */
export async function modelWorks(provider: string, model: string, key: string): Promise<{ ok: true } | { ok: false; why: string } | null> {
  try {
    const opts = { method: "POST", signal: AbortSignal.timeout(20_000) };
    const ask = "Reply with the word ok.";
    let res: Response;
    if (provider === "gemini") {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        ...opts,
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: ask }] }], generationConfig: { maxOutputTokens: 16 } }),
      });
    } else if (provider === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        ...opts,
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: "user", content: ask }] }),
      });
    } else {
      res = await fetch(`${BASE[provider]}/chat/completions`, {
        ...opts,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: ask }] }),
      });
    }
    if (res.ok) return { ok: true };
    if (res.status >= 500) return null;
    const body = await res.text().catch(() => "");
    let why = "";
    try {
      const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
      why = String((typeof j.error === "object" ? j.error?.message : j.error) ?? j.message ?? "");
    } catch {}
    why = why.split(key).join("").replace(/\s+/g, " ").trim().slice(0, 180);
    return { ok: false, why: why || `it answered with error ${res.status}` };
  } catch {
    return null;
  }
}
