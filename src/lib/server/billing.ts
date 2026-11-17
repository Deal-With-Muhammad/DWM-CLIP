import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { setting } from "@/lib/server/settings";

// Payments go through Paddle, the merchant of record: it takes the payment, charges any
// sales tax or VAT, sends receipts and handles refunds. This file and the webhook route are
// the only places that know about it.
//
// How it works:
//  1. The Settings page opens Paddle's checkout in the browser (Paddle.js), carrying the
//     member's id as custom data.
//  2. Paddle calls /api/billing/webhook whenever a subscription starts, renews, changes or
//     ends, and the `subscriptions` table is kept up to date from that.
//
// Settings (Paddle dashboard → Developer tools, and the product catalog):
//   PADDLE_ENV              "sandbox" while testing; leave empty for live payments
//   PADDLE_CLIENT_TOKEN     client-side token (starts live_ or test_); safe to show in the browser
//   PADDLE_PRICE_PRO        price id (pri_…) of the monthly "DWM Clip Pro" price
//   PADDLE_PRICE_STORAGE    price id (pri_…) of the monthly "Extra 10 GB" price
//   PADDLE_WEBHOOK_SECRET   the secret key of the notification destination (pdl_ntfset_…)
//   PADDLE_PORTAL_URL       the customer portal link, where members manage or cancel

export type Kind = "pro" | "storage";

const priceFor = (kind: Kind) => setting(kind === "pro" ? "PADDLE_PRICE_PRO" : "PADDLE_PRICE_STORAGE");

export const paymentsEnabled = (kind: Kind = "pro") => Boolean(setting("PADDLE_CLIENT_TOKEN") && priceFor(kind));

export const sandbox = () => setting("PADDLE_ENV") === "sandbox";

/** What the browser needs to open a checkout. Nothing here is secret. */
export const checkoutConfig = () => ({
  sandbox: sandbox(),
  token: setting("PADDLE_CLIENT_TOKEN"),
  prices: { pro: priceFor("pro"), storage: priceFor("storage") },
});

export const portalUrl = () => setting("PADDLE_PORTAL_URL") || null;

export function kindOfPrice(priceId: string | null | undefined): Kind | null {
  if (!priceId) return null;
  if (priceId === priceFor("pro")) return "pro";
  if (priceId === priceFor("storage")) return "storage";
  return null;
}

/** Messages older than this are refused, so a copied one can't be sent again later. */
const MAX_AGE_SECONDS = 300;

/**
 * Is this webhook really from Paddle? The Paddle-Signature header is "ts=<unix time>;h1=<hex>",
 * where h1 is the HMAC-SHA256 of "<ts>:<raw body>" with the destination's secret key.
 */
export function verifySignature(raw: string, header: string | null) {
  const secret = setting("PADDLE_WEBHOOK_SECRET");
  if (!secret || !header) return false;
  const parts = header.split(";").map((p) => p.split("=") as [string, string]);
  const ts = parts.find(([k]) => k === "ts")?.[1] ?? "";
  if (!/^\d{9,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > MAX_AGE_SECONDS) return false;
  const want = createHmac("sha256", secret).update(`${ts}:${raw}`).digest();
  // More than one h1 can be sent while a secret is being changed: any match is enough.
  return parts.some(([k, v]) => {
    if (k !== "h1" || !/^[0-9a-f]{64}$/i.test(v ?? "")) return false;
    const got = Buffer.from(v, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** The parts of a subscription webhook the site uses: one entry per thing subscribed to. */
export type SubscriptionEvent = {
  event: string;
  id: string;
  userId: string | null;
  status: string;
  /** When it stops, if it's cancelled or set to cancel. */
  endsAt: string | null;
  renewsAt: string | null;
  items: { priceId: string; kind: Kind | null; quantity: number }[];
};

export function parseSubscription(payload: unknown): SubscriptionEvent | null {
  const p = payload as { event_type?: string; data?: Record<string, unknown> };
  if (!p?.event_type?.startsWith("subscription.") || typeof p.data?.id !== "string") return null;
  const d = p.data;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const custom = (d.custom_data ?? {}) as Record<string, unknown>;
  const change = d.scheduled_change as { action?: string; effective_at?: string } | null | undefined;
  const items = Array.isArray(d.items) ? (d.items as { price?: { id?: string }; quantity?: number }[]) : [];
  return {
    event: p.event_type,
    id: d.id as string,
    userId: str(custom.user_id),
    status: String(d.status ?? ""),
    endsAt: change?.action === "cancel" || change?.action === "pause" ? str(change.effective_at) : str(d.canceled_at) ?? str(d.paused_at),
    renewsAt: str(d.next_billed_at),
    items: items.filter((i) => typeof i.price?.id === "string").map((i) => ({ priceId: i.price!.id!, kind: kindOfPrice(i.price!.id), quantity: Math.max(1, Number(i.quantity) || 1) })),
  };
}
