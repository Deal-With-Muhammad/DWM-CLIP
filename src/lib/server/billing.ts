import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { site } from "@/lib/site";
import { setting } from "@/lib/server/settings";

// Payments go through Lemon Squeezy, the merchant of record: it takes the payment, charges
// any sales tax or VAT, sends receipts and handles refunds. This file is the only place that
// knows about it, so moving to another provider later means rewriting this file and the webhook.
//
// The site only:
//  1. creates a checkout for a subscription, carrying the member's id as custom data; and
//  2. listens for subscription webhooks and keeps the `subscriptions` table up to date.
//
// Settings:
//   LEMONSQUEEZY_API_KEY           API key (test-mode keys make test checkouts)
//   LEMONSQUEEZY_STORE_ID          numeric store id
//   LEMONSQUEEZY_VARIANT_PRO       variant id of the monthly "DWM Clip Pro" subscription
//   LEMONSQUEEZY_VARIANT_STORAGE   variant id of the monthly "Extra 10 GB" subscription
//   LEMONSQUEEZY_WEBHOOK_SECRET    the signing secret typed into the webhook

const env = setting;

export type Kind = "pro" | "storage";

const variantFor = (kind: Kind) => env(kind === "pro" ? "LEMONSQUEEZY_VARIANT_PRO" : "LEMONSQUEEZY_VARIANT_STORAGE");

export const paymentsEnabled = (kind: Kind = "pro") => Boolean(env("LEMONSQUEEZY_API_KEY") && env("LEMONSQUEEZY_STORE_ID") && variantFor(kind));

export function kindOfVariant(variantId: string | null): Kind | null {
  if (!variantId) return null;
  if (variantId === env("LEMONSQUEEZY_VARIANT_PRO")) return "pro";
  if (variantId === env("LEMONSQUEEZY_VARIANT_STORAGE")) return "storage";
  return null;
}

/** A checkout page for this member. Returns its address. */
export async function createCheckout({ kind, userId, email }: { kind: Kind; userId: string; email: string }): Promise<string> {
  const back = `${site.url}/app/settings?paid=${kind}`;
  const body = {
    data: {
      type: "checkouts",
      attributes: {
        product_options: { redirect_url: back, receipt_button_text: "Back to DWM Clip", receipt_link_url: back, enabled_variants: [Number(variantFor(kind))] },
        checkout_options: { embed: false, media: false, logo: true, button_color: site.color },
        checkout_data: { email, custom: { user_id: userId, kind } },
        expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      },
      relationships: {
        store: { data: { type: "stores", id: env("LEMONSQUEEZY_STORE_ID") } },
        variant: { data: { type: "variants", id: variantFor(kind) } },
      },
    },
  };
  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", Authorization: `Bearer ${env("LEMONSQUEEZY_API_KEY")}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => null)) as { data?: { attributes?: { url?: string } }; errors?: { detail?: string }[] } | null;
  const url = j?.data?.attributes?.url;
  if (!res.ok || !url) throw new Error(`Lemon Squeezy checkout failed (${res.status}): ${j?.errors?.[0]?.detail ?? "no url"}`);
  return url;
}

/** Is this webhook really from Lemon Squeezy? (HMAC-SHA256 of the raw body, hex, in X-Signature.) */
export function verifySignature(raw: string, signature: string | null) {
  const secret = env("LEMONSQUEEZY_WEBHOOK_SECRET");
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const want = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(signature, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The parts of a subscription webhook the site uses. */
export type SubscriptionEvent = {
  event: string;
  id: string;
  userId: string | null;
  kind: Kind | null;
  status: string;
  quantity: number;
  renewsAt: string | null;
  endsAt: string | null;
  portal: string | null;
  email: string | null;
  testMode: boolean;
};

export function parseSubscription(payload: unknown): SubscriptionEvent | null {
  const p = payload as { meta?: { event_name?: string; custom_data?: Record<string, unknown> }; data?: { type?: string; id?: string; attributes?: Record<string, unknown> } };
  if (p?.data?.type !== "subscriptions" || !p.data.id || !p.data.attributes) return null;
  const a = p.data.attributes;
  const custom = p.meta?.custom_data ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const item = a.first_subscription_item as { quantity?: number } | undefined;
  return {
    event: p.meta?.event_name ?? "",
    id: p.data.id,
    userId: str(custom.user_id),
    kind: kindOfVariant(a.variant_id != null ? String(a.variant_id) : null) ?? (custom.kind === "pro" || custom.kind === "storage" ? custom.kind : null),
    status: String(a.status ?? ""),
    quantity: Math.max(1, Number(item?.quantity ?? 1) || 1),
    renewsAt: str(a.renews_at),
    endsAt: str(a.ends_at),
    portal: str((a.urls as { customer_portal?: string } | undefined)?.customer_portal),
    email: str(a.user_email),
    testMode: a.test_mode === true,
  };
}

/** Test-mode payments count only where they're switched on (development and the test setup). */
export const acceptsTestOrders = () => env("LEMONSQUEEZY_ACCEPT_TEST_ORDERS") === "1" || process.env.NODE_ENV !== "production";
