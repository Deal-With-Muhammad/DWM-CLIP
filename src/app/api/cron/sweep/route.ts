import { NextResponse } from "next/server";

import { logAdmin } from "@/lib/server/auth-helpers";
import { settleEnded } from "@/lib/server/budget";
import { clientIp } from "@/lib/server/http";
import { sweepExpired, sweepFreeClips } from "@/lib/server/library";
import { currentUser, isAdminEmail, same } from "@/lib/server/session";
import { setting } from "@/lib/server/settings";

// The daily clean-up: Free-plan clips older than the plan keeps them are deleted, oldest first.
// Called by the Worker's own timer (custom-worker.ts) with the engine's shared secret, or by an admin
// who is signed in. `?dry=1` only counts; an admin may also pass `days` to see what another limit would do.
export async function POST(req: Request) {
  const secret = setting("ENGINE_SECRET");
  const timer = Boolean(secret) && same(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
  const admin = timer ? null : await currentUser();
  if (!timer && !isAdminEmail(admin?.email)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const q = new URL(req.url).searchParams;
  const dry = q.get("dry") === "1";
  const days = Number(q.get("days"));
  // Only a count may use another number of days: what is deleted always follows the plan.
  const swept = await sweepFreeClips(dry && days >= 1 ? { days, dry } : { dry });
  if (!dry) await sweepExpired();
  // Videos that stopped without a last word go into the spending ledger.
  if (!dry) await settleEnded();
  if (!dry && admin) await logAdmin(admin.email, "sweep-free-clips", `${swept.clips} clips, ${swept.bytes} bytes`, clientIp(req.headers));
  console.log("clean-up", JSON.stringify(swept));
  return NextResponse.json(swept);
}
