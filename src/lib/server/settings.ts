import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

// Values pasted into a host's settings often pick up quotes or a trailing space.
export const clean = (v: string | undefined) => (v ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();

/**
 * A setting or secret by name. On Cloudflare these arrive in process.env; in `next dev`
 * they come from .dev.vars through the Cloudflare context, so nothing secret has to sit
 * in a .env file that the build would copy into the Worker.
 */
export function setting(name: string): string {
  const own = clean(process.env[name]);
  if (own) return own;
  try {
    const v = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    return typeof v === "string" ? clean(v) : "";
  } catch {
    return "";
  }
}
