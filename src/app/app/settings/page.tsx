import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { FREE, PRO, STORAGE_PACK, formatBytes } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { checkoutConfig, paymentsEnabled, portalUrl, provider } from "@/lib/server/billing";
import { lemonCheckout } from "@/lib/server/lemonsqueezy";
import { site } from "@/lib/site";
import { keyInfo } from "@/lib/server/keys";
import { currentUser, isAdminEmail } from "@/lib/server/session";

import { KeyForm } from "./key-form";
import { PayButton } from "./pay-button";

export const metadata = { title: "Settings", robots: { index: false, follow: false } };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/app/settings");
  const [account, key, q] = await Promise.all([accountOf(user), keyInfo(user.id), searchParams]);
  const pro = account.plan === "pro";
  // Lemon Squeezy sends the member to its own checkout page; Paddle opens its checkout over this one.
  const lemon = provider() === "lemonsqueezy";
  const paddle = checkoutConfig();
  const checkout = { sandbox: paddle.sandbox, token: paddle.token, userId: user.id, email: user.email };
  const proLink = lemon ? lemonCheckout("pro", user.id) : null;
  const storageLink = lemon ? lemonCheckout("storage", user.id) : null;
  const canPay = lemon ? Boolean(proLink) : paymentsEnabled("pro");
  const canAddStorage = lemon ? Boolean(storageLink) : paymentsEnabled("storage");
  const portal = account.portal ?? (lemon ? null : portalUrl());
  return (
    <>
      <AppHeader email={user.email} plan={account.plan} admin={isAdminEmail(user.email)} />
      <main className="mx-auto w-full max-w-[760px] px-4 pb-20 sm:px-6">
        <h1 className="mt-8 font-display text-[28px]">Settings</h1>

        {q.paid && (
          <p className="mt-4 rounded-xl bg-brand-soft px-3.5 py-2.5 text-[14px] text-brand-ink">
            Thank you! {pro ? "Your plan is active." : "Your payment is being confirmed. This page updates within a minute: refresh it if Pro isn't showing yet."}
          </p>
        )}

        <section id="plan" className="card mt-6 scroll-mt-6 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[20px]">Your plan: {pro ? "Pro" : "Free"}</h2>
            <p className="text-[14px] text-muted">
              {account.clipsLeft} of {account.clips} clips left{pro ? " this month" : ""} · {formatBytes(account.used)} of {formatBytes(account.storage)} used
            </p>
          </div>

          {pro ? (
            <>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
                {PRO.clips} clips a month with our AI, {formatBytes(PRO.storage)} of storage{account.storagePacks > 0 ? ` plus ${formatBytes(account.storagePacks * STORAGE_PACK.bytes)} extra` : ""}, 1080p, videos up to {PRO.maxHours} hours.
                {account.proEnds && ` Your plan is cancelled and stays on until ${new Date(account.proEnds).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {canAddStorage &&
                  (storageLink ? (
                    <a href={storageLink} className="inline-flex h-11 items-center rounded-xl border border-line-strong px-5 text-[15px] font-medium hover:bg-subtle">
                      Add {formatBytes(STORAGE_PACK.bytes)} for ${STORAGE_PACK.price}/month
                    </a>
                  ) : (
                    <PayButton kind="storage" priceId={paddle.prices.storage} checkout={checkout} label={`Add ${formatBytes(STORAGE_PACK.bytes)} for $${STORAGE_PACK.price}/month`} variant="outline" />
                  ))}
                {portal && (
                  <a href={portal} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-xl px-4 text-[15px] font-medium text-ink-2 underline underline-offset-4 hover:text-ink">
                    Manage or cancel
                  </a>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-4">
                <p className="text-[15px] font-medium">Free</p>
                <ul className="mt-2 space-y-1.5 text-[14px] text-ink-2">
                  <li>{FREE.clips} clips, with your own AI key</li>
                  <li>{formatBytes(FREE.storage)} of storage</li>
                  <li>720p, videos up to {FREE.maxHours} hour</li>
                </ul>
              </div>
              <div className="rounded-xl border-2 border-brand p-4">
                <p className="text-[15px] font-medium">
                  Pro · ${PRO.price}/month
                </p>
                <ul className="mt-2 space-y-1.5 text-[14px] text-ink-2">
                  <li>{PRO.clips} clips a month, no AI key needed</li>
                  <li>{formatBytes(PRO.storage)} of storage, more from ${STORAGE_PACK.price}/month</li>
                  <li>1080p, videos up to {PRO.maxHours} hours, {PRO.clipsPerVideo} clips per video</li>
                </ul>
                <div className="mt-4">
                  {proLink ? (
                    <a href={proLink} className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-[15px] font-medium text-white hover:bg-brand-ink">
                      Go Pro for ${PRO.price}/month
                    </a>
                  ) : (
                    <PayButton kind="pro" priceId={paddle.prices.pro} checkout={checkout} label={`Go Pro for $${PRO.price}/month`} />
                  )}
                </div>
                <p className="mt-2 text-[12.5px] text-muted">{canPay ? `Cancel any time. Payment is handled by ${site.seller}, our reseller.` : "Card payments open soon."}</p>
              </div>
            </div>
          )}
        </section>

        <section id="ai" className="card mt-4 scroll-mt-6 p-5 sm:p-6">
          <h2 className="font-display text-[20px]">Your AI key</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
            {pro
              ? "Pro uses our AI, so you don't need this. A key saved here is only used if you go back to the free plan."
              : "On the free plan, the AI that picks the best moments runs on your own key. Google gives Gemini keys for free."}
          </p>
          <KeyForm saved={key} />
        </section>

        <section className="card mt-4 p-5 sm:p-6">
          <h2 className="font-display text-[20px]">Account</h2>
          <p className="mt-1.5 text-[14.5px] text-ink-2">Signed in as {user.email}</p>
          <p className="mt-1 text-[13.5px] text-muted">To delete your account and every clip, email me@dealwithmuhammad.com from this address.</p>
        </section>
      </main>
    </>
  );
}
