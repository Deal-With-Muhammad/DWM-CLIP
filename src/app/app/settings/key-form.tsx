"use client";

import { Button } from "@heroui/react";
import { useEffect, useState } from "react";

import { PROVIDERS } from "@/lib/plans";

import { ModelPicker } from "./model-picker";

type Saved = { provider: string; model: string; tail: string; updatedAt: string } | null;

/** Choose an AI service and paste its key. The key is checked, stored encrypted, and never shown again. */
export function KeyForm({ saved: initial }: { saved: Saved }) {
  const [saved, setSaved] = useState(initial);
  const [provider, setProvider] = useState<string>(initial?.provider ?? "gemini");
  const [model, setModel] = useState(initial?.model ?? PROVIDERS[0].model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const p = PROVIDERS.find((x) => x.id === provider) ?? PROVIDERS[0];

  // The service's own list of models, fetched with the key being typed or the saved one (OpenRouter's is public).
  // Kept with what it was fetched for, so a list for another service or key is never shown.
  const typed = key.trim().length >= 16 ? key.trim() : "";
  const source = `${provider}:${typed || (saved?.provider === provider ? `saved ${saved.tail}` : "")}`;
  const canList = provider === "openrouter" || !source.endsWith(":");
  const [listed, setListed] = useState<{ source: string; models: string[] } | null>(null);
  useEffect(() => {
    if (!canList) return;
    const stop = new AbortController();
    const wait = setTimeout(
      async () => {
        const res = await fetch("/api/keys/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, key: typed }), signal: stop.signal }).catch(() => null);
        const j = await res?.json().catch(() => null);
        if (!stop.signal.aborted && Array.isArray(j?.models)) setListed({ source, models: j.models });
      },
      typed ? 600 : 0, // while a key is being pasted or typed, wait for it to settle
    );
    return () => {
      clearTimeout(wait);
      stop.abort();
    };
  }, [provider, typed, source, canList]);
  const live = canList && listed?.source === source && listed.models.length > 0 ? listed.models : null;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/keys", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model, key }) }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) return setMessage({ ok: false, text: j?.error || "Couldn't save the key. Please try again." });
    setSaved(j.key);
    setKey("");
    setMessage({ ok: true, text: j.checked ? "Saved. The key works." : "Saved. The service couldn't be reached to check it, so your first video will tell." });
  };

  return (
    <form
      className="mt-4 space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {saved && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-subtle px-3.5 py-2.5 text-[14px]">
          <span>
            Saved: <strong className="font-medium">{PROVIDERS.find((x) => x.id === saved.provider)?.label ?? saved.provider}</strong>, {saved.model}, key ending <span className="font-mono">{saved.tail}</span>
          </span>
          <button
            type="button"
            className="rounded-lg bg-danger-soft px-2.5 py-1 text-[13.5px] font-medium text-danger"
            onClick={async () => {
              await fetch("/api/keys", { method: "DELETE" });
              setSaved(null);
              setMessage(null);
            }}
          >
            Remove key
          </button>
        </p>
      )}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block text-[14px]">
          <span className="mb-1.5 block font-medium">AI service</span>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel(PROVIDERS.find((x) => x.id === e.target.value)?.model ?? "");
            }}
            className="field-native"
          >
            {PROVIDERS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {x.free ? " (free key)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[14px]">
          <span className="mb-1.5 block font-medium">Model</span>
          <ModelPicker value={model} onChange={setModel} options={live ?? p.models} />
          <span className="mt-1.5 block text-[12.5px] text-muted">{live ? `${live.length} models from ${p.label}. Type to search.` : `A few to start with. Paste your key to see every ${p.label} model.`}</span>
        </label>
      </div>
      <label className="block text-[14px]">
        <span className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="font-medium">API key</span>
          <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-[13px] text-brand-ink underline underline-offset-4">
            Get a {p.label} key
          </a>
        </span>
        <input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder={saved ? "Paste a new key to replace the saved one" : "Paste your key"} className="field-native font-mono text-[14px]" />
      </label>
      {message && (
        <p role={message.ok ? undefined : "alert"} className={`rounded-xl px-3.5 py-2.5 text-[14px] ${message.ok ? "bg-sky-soft text-sky" : "bg-danger-soft text-danger"}`}>
          {message.text}
        </p>
      )}
      <Button type="submit" isDisabled={busy || key.trim().length < 16}>
        {busy ? "Checking the key…" : "Save and test"}
      </Button>
      <p className="text-[12.5px] leading-relaxed text-muted">Your key is stored encrypted, used only to clip your own videos, and you pay that service directly for what it uses (often nothing, on a free tier).</p>
    </form>
  );
}
