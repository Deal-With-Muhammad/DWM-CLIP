import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { accountOf } from "@/lib/server/account";
import { provider } from "@/lib/server/billing";
import { keyInfo } from "@/lib/server/keys";
import { passCheckout } from "@/lib/server/lemonsqueezy";
import { listJobs } from "@/lib/server/library";
import { currentUser, isAdminEmail } from "@/lib/server/session";

import { Studio } from "./studio";

export const metadata = { title: "Your clips", robots: { index: false, follow: false } };

export default async function AppPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  const q = await searchParams;
  const url = typeof q.url === "string" ? q.url.slice(0, 500) : "";
  if (!user) redirect(`/login?next=${encodeURIComponent(url ? `/app?url=${encodeURIComponent(url)}` : "/app")}`);
  const [jobs, account, key] = await Promise.all([listJobs(user.id), accountOf(user), keyInfo(user.id)]);
  return (
    <>
      <AppHeader email={user.email} plan={account.plan} planName={account.planName} admin={isAdminEmail(user.email)} />
      <Studio
        initial={{ jobs, account }}
        hasKey={Boolean(key)}
        startUrl={url}
        // Where a member with no plan buys one: straight to the checkout, with their id on it.
        buy={provider() === "lemonsqueezy" ? { lite: passCheckout("lite", user.id), pro: passCheckout("pro", user.id) } : { lite: null, pro: null }}
      />
    </>
  );
}
