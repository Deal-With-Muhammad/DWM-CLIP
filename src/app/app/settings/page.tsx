import { Check } from "lucide-react";
import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { FREE, LITE, PRO, STORAGE_PACK, formatBytes, type Plan } from "@/lib/plans";
import { accountOf } from "@/lib/server/account";
import { checkoutConfig, paymentsEnabled, portalUrl, provider, type Kind } from "@/lib/server/billing";
import { keyInfo } from "@/lib/server/keys";
import { lemonCheckout } from "@/lib/server/lemonsqueezy";
import { currentUser, isAdminEmail } from "@/lib/server/session";
import { site } from "@/lib/site";

import { KeyForm } from "./key-form";
import { PayButton } from "./pay-button";

export const metadata = { title: "Settings", robots: { index: false, follow: false } };

const rows = (p: Plan) => [
  p.id === "free" ? `${p.clips} clips to try it` : `${p.clips} clips every month`,
  p.ourAi ? "Our AI, no key needed" : "Your own AI key",
  `${formatBytes(p.storage)} of storage`,
  `Videos up to ${p.maxHours} hour${p.maxHours === 1 ? "" : "s"}`,
  ...(p.id === "pro" ? [`${p.clipsPerVideo} clips from one video`, "Two videos at once"] : []),
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/app/settings");
  const [account, key, q] = await Promise.all([accountOf(user), keyInfo(user.id), searchParams]);
  // Lemon Squeezy sends the member to its own checkout page; Paddle opens its checkout over this one.
  const lemon = provider() === "lemonsqueezy";
  const paddle = checkoutConfig();
  const checkout = { sandbox: paddle.sandbox, token: paddle.token, userId: user.id, email: user.email };
  const link = (kind: Kind) => (lemon ? lemonCheckout(kind, user.id) : null);
  const canBuy = (kind: Kind) => (lemon ? Boolean(link(kind)) : paymentsEnabled(kind));
  const portal = account.portal ?? (lemon ? null : portalUrl());
  const paid = account.plan !== "free";
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const buy = (kind: Kind, label: string, quiet = false) => {
    if (!canBuy(kind)) return null;
    const href = link(kind);
    if (href)
      return (
        <a href={href} className={quiet ? "btn-quiet" : "btn"}>
          {label}
        </a>
      );
    return <PayButton kind={kind} priceId={paddle.prices[kind]} checkout={checkout} label={label} variant={quiet ? "outline" : "primary"} />;
  };

  return (
    <>
      <AppHeader email={user.email} plan={account.plan} planName={account.planName} admin={isAdminEmail(user.email)} />
      <main className="mx-auto w-full max-w-[860px] px-4 pb-20 sm:px-6">
        <h1 className="mt-8 font-display text-[28px]">Settings</h1>

        {q.paid && (
          <p className="mt-4 rounded-xl bg-sky-soft px-3.5 py-2.5 text-[14px] text-sky">
            Thank you! {paid ? "Your plan is active." : "Your payment is being confirmed. Refresh this page in a minute if your plan isn't showing yet."}
          </p>
        )}

        <section id="plan" className="card mt-6 scroll-mt-20 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-[20px]">Your plan: {account.planName}</h2>
            <p className="text-[14px] text-muted">
              {account.clipsLeft} of {account.clips} clips left{paid ? " this month" : ""} · {formatBytes(account.used)} of {formatBytes(account.storage)} used
            </p>
          </div>
          {account.planEnds && paid && <p className="mt-2 text-[14px] text-warn-ink">Your plan is cancelled and stays on until {day(account.planEnds)}.</p>}
          {account.paysForBoth && (
            <p className="mt-2 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[14px] text-warn-ink">You&apos;re on Pro and still paying for Lite. Cancel Lite with &quot;Manage or cancel&quot; below so you aren&apos;t charged for both.</p>
          )}

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[FREE, LITE, PRO].map((p) => {
              const mine = p.id === account.plan;
              const up = (p.id === "lite" && account.plan === "free") || (p.id === "pro" && account.plan !== "pro");
              return (
                <div key={p.id} className={`flex flex-col rounded-xl p-4 ${mine ? "border-2 border-brand" : "border border-line"}`}>
                  <p className="flex items-center gap-2 text-[15px] font-semibold">
                    {p.name}
                    {mine && <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-brand-ink">Your plan</span>}
                  </p>
                  <p className="mt-1 font-display text-[26px] leading-none">
                    ${p.price}
                    {p.price > 0 && <span className="text-[14px] font-normal text-muted"> /month</span>}
                  </p>
                  <ul className="mt-3.5 flex-1 space-y-1.5 text-[13.5px] text-ink-2">
                    {rows(p).map((r) => (
                      <li key={r} className="flex gap-2">
                        <Check className="mt-[3px] size-[15px] shrink-0 text-brand" aria-hidden />
                        {r}
                      </li>
                    ))}
                  </ul>
                  {up && p.id !== "free" && <div className="mt-4">{buy(p.id, `Get ${p.name}`, p.id === "lite") ?? <p className="text-[12.5px] text-muted">Card payments open soon.</p>}</div>}
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            {paid && buy("storage", `Add ${formatBytes(STORAGE_PACK.bytes)} for $${STORAGE_PACK.price}/month`, true)}
            {paid && portal && (
              <a href={portal} target="_blank" rel="noreferrer" className="text-[14.5px] font-medium text-ink-2 underline underline-offset-4 hover:text-ink">
                Manage or cancel
              </a>
            )}
            <p className="text-[12.5px] text-muted">Cancel any time. Payment is handled by {site.seller}, our reseller. 14-day refund.</p>
          </div>
        </section>

        <section id="ai" className="card mt-4 scroll-mt-20 p-5 sm:p-6">
          <h2 className="font-display text-[20px]">Your AI key</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
            {account.ourAi
              ? `${account.planName} uses our AI, so you don't need this. A key saved here is only used if you go back to the free plan.`
              : "On the free plan, the AI that picks the best moments runs on your own key. Pick any service below; some of them give keys away for free."}
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
