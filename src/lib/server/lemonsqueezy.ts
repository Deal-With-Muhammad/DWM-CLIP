import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Kind } from "@/lib/server/billing";
import { setting } from "@/lib/server/settings";

// Lemon Squeezy, used for payments until the move to Paddle (Lemon Squeezy stops taking
// payments on 31 March 2027). It is the merchant of record while it's switched on.
//
// How it works:
//  1. The Settings page links to the product's checkout page, with the member's id added
//     as custom data. No API key is needed for that.
//  2. Lemon Squeezy calls /api/billing/lemonsqueezy whenever a subscription starts, renews,
//     is cancelled or ends, and the `subscriptions` table is kept up to date from that.
//
// Settings:
//   LEMONSQUEEZY_LINK_LITE, _PRO, _STORAGE       each product's checkout link (Share → Checkout link)
//   LEMONSQUEEZY_PRODUCT_LITE, _PRO, _STORAGE    each product's numeric id
//   LEMONSQUEEZY_WEBHOOK_SECRET                              the signing secret typed into the webhook

const linkFor = (kind: Kind) => setting(kind === "pro" ? "LEMONSQUEEZY_LINK_PRO" : kind === "lite" ? "LEMONSQUEEZY_LINK_LITE" : "LEMONSQUEEZY_LINK_STORAGE");

export const lemonEnabled = (kind: Kind) => Boolean(linkFor(kind));

/** The checkout page for this member. Their id travels with the payment and comes back in the webhook. */
export function lemonCheckout(kind: Kind, userId: string) {
  const link = linkFor(kind);
  return link ? `${link}?${encodeURIComponent("checkout[custom][user_id]")}=${encodeURIComponent(userId)}` : null;
}

function kindOfProduct(productId: string | null): Kind | null {
  if (!productId) return null;
  if (productId === setting("LEMONSQUEEZY_PRODUCT_PRO")) return "pro";
  if (productId === setting("LEMONSQUEEZY_PRODUCT_LITE")) return "lite";
  if (productId === setting("LEMONSQUEEZY_PRODUCT_STORAGE")) return "storage";
  return null;
}

/** Is this webhook really from Lemon Squeezy? (HMAC-SHA256 of the raw body, hex, in X-Signature.) */
export function verifyLemonSignature(raw: string, signature: string | null) {
  const secret = setting("LEMONSQUEEZY_WEBHOOK_SECRET");
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const want = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(signature, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The parts of a subscription webhook the site uses. */
export type LemonSubscription = {
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

export function parseLemonSubscription(payload: unknown): LemonSubscription | null {
  const p = payload as { meta?: { event_name?: string; custom_data?: Record<string, unknown> }; data?: { type?: string; id?: string; attributes?: Record<string, unknown> } };
  if (p?.data?.type !== "subscriptions" || !p.data.id || !p.data.attributes) return null;
  const a = p.data.attributes;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const item = a.first_subscription_item as { quantity?: number } | undefined;
  return {
    event: p.meta?.event_name ?? "",
    id: p.data.id,
    userId: str(p.meta?.custom_data?.user_id),
    // What was bought is read from the product, never from anything the buyer's browser sent.
    kind: kindOfProduct(a.product_id != null ? String(a.product_id) : null),
    status: String(a.status ?? ""),
    quantity: Math.max(1, Number(item?.quantity ?? 1) || 1),
    renewsAt: str(a.renews_at),
    endsAt: str(a.ends_at),
    portal: str((a.urls as { customer_portal?: string } | undefined)?.customer_portal),
    email: str(a.user_email),
    testMode: a.test_mode === true,
  };
}

/** Test-mode payments count only where they're switched on (development, or while trying the checkout). */
export const acceptsTestOrders = () => setting("LEMONSQUEEZY_ACCEPT_TEST_ORDERS") === "1" || process.env.NODE_ENV !== "production";
