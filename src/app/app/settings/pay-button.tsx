"use client";

import { Button } from "@heroui/react";
import { useState } from "react";

/** Opens the payment page for Pro or for extra storage. */
export function PayButton({ kind, label, disabled, variant = "primary" }: { kind: "pro" | "storage"; label: string; disabled?: boolean; variant?: "primary" | "outline" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1.5">
      <Button
        variant={variant}
        isDisabled={busy || disabled}
        onPress={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) }).catch(() => null);
          const j = await res?.json().catch(() => ({}));
          if (res?.ok && j.url) return window.location.assign(j.url);
          setError(j?.error || "Couldn't open the payment page. Please try again.");
          setBusy(false);
        }}
      >
        {busy ? "Opening…" : label}
      </Button>
      {error && (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
