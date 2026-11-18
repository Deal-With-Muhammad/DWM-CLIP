import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { Look } from "@/lib/look";
import { setting } from "@/lib/server/settings";

// The clip engine (the engine/ folder) does the video work: it fetches the video,
// finds the moments and renders the clips, then sends progress and files back to
// /api/engine/*. This site only starts jobs there.
//   ENGINE_URL      where the engine listens, e.g. http://127.0.0.1:8080 in development
//   ENGINE_SECRET   shared by both sides

const secret = () => setting("ENGINE_SECRET");

export const engineReady = () => Boolean(setting("ENGINE_URL") && secret());

/** What the engine must send back with every message about this job. */
export const jobToken = (jobId: string) => createHmac("sha256", secret()).update(`job:${jobId}`).digest("hex");

export function checkJobToken(jobId: string, header: string | null) {
  if (!secret() || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const want = Buffer.from(jobToken(jobId));
  return got.length === want.length && timingSafeEqual(got, want);
}

export type EngineJob = {
  id: string;
  url: string;
  callback: string;
  options: { max_clips: number; min_len: number; max_len: number; style: string; layout: string; captions: boolean; quality: number };
  ai: { provider: string; model: string; key: string } | null;
  max_hours: number;
  /** What the member asked the AI to look for. */
  focus: string;
  /** The member's own caption look, or null for one of the ready-made styles. */
  look: Look | null;
  /** A video longer than the plan takes at once: the second the clipped stretch starts at. */
  from: number;
  /** Where the engine should start its container, when the link was only reachable from there. "" is near the member. */
  place: string;
};

// A container starts near the member, and YouTube turns away the addresses of some places ("confirm you're not
// a bot"). These are the other parts of the world tried, in order (the engine's own list is in engine/runner.py).
// Looked at on 2026-11-19: YouTube turned away our containers in Frankfurt, Warsaw and Seattle, and accepted
// the ones in London, Amsterdam, Chicago, Atlanta, Singapore, Tokyo and Sydney.
export const PLACES = ["weur", "enam", "apac", "apac-ne"];
/** Every place the engine knows. A link can be looked at from any one of them, to see which the video sites accept. */
export const ALL_PLACES = ["wnam", "enam", "weur", "eeur", "apac", "apac-ne", "apac-se", "oc"];

/** What a link is, looked up by the engine before anything is made. `place` is where it could be reached from. */
export type LinkCheck = { ok: boolean; title?: string; uploader?: string; seconds?: number; live?: boolean; thumb?: string; error?: string; refused?: boolean; slow?: boolean; where?: { colo?: string; country?: string }; place: string };

/**
 * Looks a link up, moving to another part of the world when YouTube turns the first one away. With `only`, it is
 * looked at from that one place and nowhere else. Null when the engine can't be asked.
 */
export async function checkLink(url: string, only?: string): Promise<LinkCheck | null> {
  let last: LinkCheck | null = null;
  for (const place of only ? [only] : ["", ...PLACES].slice(0, 4)) {
    try {
      const res = await fetch(`${setting("ENGINE_URL").replace(/\/$/, "")}/check`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret()}` },
        body: JSON.stringify({ id: `check-${randomUUID()}`, url, ...(place ? { place } : {}) }),
        signal: AbortSignal.timeout(80_000),
      });
      if (!res.ok) return last;
      last = { ...((await res.json()) as Omit<LinkCheck, "place">), place };
    } catch {
      return last;
    }
    console.log("link check", place || "near", JSON.stringify(last.where ?? {}), last.ok ? "ok" : last.refused ? "refused" : (last.error ?? "").slice(0, 80));
    if (last.ok || !last.refused) return last;
  }
  return last;
}

/** A changed clip to make again. `job` is the video it belongs to, which is what the engine reports back about. */
export type EngineEdit = { id: string; mode: "edit"; job: string; url: string; callback: string; quality: number; clip: Record<string, unknown>; words: unknown; fixed_words: unknown; fixed_for: unknown; beats: unknown[]; tighten: boolean; live: boolean };

export const startEdit = (edit: EngineEdit) => send(edit, edit.job);

export const startJob = (job: EngineJob) => send(job, job.id);

async function send(job: EngineJob | EngineEdit, tokenFor: string) {
  const res = await fetch(`${setting("ENGINE_URL").replace(/\/$/, "")}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret()}` },
    body: JSON.stringify({ ...job, token: jobToken(tokenFor) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new Error("busy");
  if (!res.ok) throw new Error(`engine answered ${res.status}`);
}
