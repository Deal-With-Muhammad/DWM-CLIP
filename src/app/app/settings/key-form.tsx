"use client";

import { Button } from "@heroui/react";
import { useState } from "react";

import { PROVIDERS } from "@/lib/plans";

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
            className="text-danger underline underline-offset-4"
            onClick={async () => {
              await fetch("/api/keys", { method: "DELETE" });
              setSaved(null);
              setMessage(null);
            }}
          >
            Remove
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
          <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} autoCapitalize="none" className="field-native font-mono text-[14px]" />
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
        <p role={message.ok ? undefined : "alert"} className={`rounded-xl px-3.5 py-2.5 text-[14px] ${message.ok ? "bg-brand-soft text-brand-ink" : "bg-danger-soft text-danger"}`}>
          {message.text}
        </p>
      )}
      <Button type="submit" isDisabled={busy || key.trim().length < 16}>
        {busy ? "Checking the key…" : "Save and test"}
      </Button>
      <p className="text-[12.5px] leading-relaxed text-muted">Your key is stored encrypted, used only to clip your own videos, and you pay that service directly for what it uses (usually nothing on Gemini&apos;s free tier).</p>
    </form>
  );
}
