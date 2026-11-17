import "server-only";

import { site } from "@/lib/site";

/** The visitor's IP (first hop the host's CDN saw), or "local" in development. */
export function clientIp(headers: Headers) {
  return headers.get("cf-connecting-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

/**
 * The site's own address. Fixed in production and never read from request
 * headers, because anyone can send those: a forged host would otherwise put an
 * attacker's address in the sign-in link emailed to a victim.
 */
export function siteOrigin(req: Request) {
  return process.env.NODE_ENV === "production" ? site.url : new URL(req.url).origin;
}

/** A JSON error response. */
export const fail = (status: number, error: string, extra?: Record<string, unknown>) => Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });
