"use client";

import { Button } from "@heroui/react";
import { useState } from "react";

type PaddleJs = {
  Environment: { set(env: "sandbox"): void };
  Initialize(options: { token: string; eventCallback?: (event: { name?: string }) => void }): void;
  Checkout: { open(options: Record<string, unknown>): void };
};

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

export type Checkout = { sandbox: boolean; token: string; userId: string; email: string };

let loading: Promise<PaddleJs> | null = null;
let paid: (() => void) | null = null;

/** Loads Paddle's checkout script once, the first time someone presses a pay button. */
function paddle(config: Checkout) {
  loading ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.onload = () => {
      const p = window.Paddle;
      if (!p) return reject(new Error("Paddle didn't load"));
      if (config.sandbox) p.Environment.set("sandbox");
      p.Initialize({ token: config.token, eventCallback: (e) => e.name === "checkout.completed" && paid?.() });
      resolve(p);
    };
    s.onerror = () => {
      loading = null;
      reject(new Error("Paddle didn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens Paddle's checkout for Pro or for extra storage. */
export function PayButton({ kind, priceId, label, checkout, variant = "primary" }: { kind: "lite" | "pro" | "storage"; priceId: string; label: string; checkout: Checkout; variant?: "primary" | "outline" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = Boolean(checkout.token && priceId);
  return (
    <span className="inline-flex flex-col gap-1.5">
      <Button
        variant={variant}
        isDisabled={busy || !ready}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const p = await paddle(checkout);
            // Paddle tells the site about the payment a moment later, so the page waits briefly before it reloads.
            paid = () => setTimeout(() => window.location.assign(`/app/settings?paid=${kind}`), 2500);
            p.Checkout.open({
              items: [{ priceId, quantity: 1 }],
              customer: { email: checkout.email },
              customData: { user_id: checkout.userId },
              settings: { displayMode: "overlay", theme: "light", allowLogout: false },
            });
          } catch {
            setError("Couldn't open the payment page. Check your connection or ad blocker and try again.");
          }
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
