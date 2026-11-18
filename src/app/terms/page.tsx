import { Legal } from "@/components/legal";
import { FREE, LITE, PRO, formatBytes } from "@/lib/plans";
import { site } from "@/lib/site";

export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <Legal title="Terms" updated="18 November 2026">
      <section>
        <h2>What DWM Clip is</h2>
        <p>DWM Clip turns a video you give it a link to into short vertical clips. It is operated by Rafay Khan, trading as Deal With Muhammad (dealwithmuhammad.com), referred to here as &quot;we&quot;. By using it you agree to these terms.</p>
      </section>
      <section>
        <h2>Videos you clip</h2>
        <p>
          Only clip videos you made, or have permission to use (for example, a creator or brand that invites people to clip their content). You are responsible for the rights to what you download, clip and post, and for following the rules of the sites you fetch
          from and post to. If a rights holder asks, clips may be removed and repeat misuse ends the account.
        </p>
      </section>
      <section>
        <h2>Plans and limits</h2>
        <p>
          On every plan the clips are made with your own AI key, and you can keep as many as fit in your storage. Free: {formatBytes(FREE.storage)} of storage, {FREE.clipsPerVideo} clips from one video, up to {FREE.clips} clips a month. Lite: {formatBytes(LITE.storage)}, {LITE.clipsPerVideo} clips from one video, up to {LITE.clips} a month. Pro: {formatBytes(PRO.storage)}, {PRO.clipsPerVideo} clips from one video, up to {PRO.clips} a month. Paid plans are billed monthly until cancelled. Limits may change; a change never shortens a month you
          already paid for.
        </p>
      </section>
      <section>
        <h2>Payments and refunds</h2>
        <p>
          Our order process is conducted by our online reseller {site.seller}. {site.seller} is the Merchant of Record for all our orders, and handles payment questions and returns. You can cancel any time from Settings and keep Pro until the end
          of the paid month. Refunds are covered by the <a href="/refund" className="text-brand-ink underline underline-offset-4">refund policy</a>.
        </p>
      </section>
      <section>
        <h2>Your AI key</h2>
        <p>Clips are made with an AI key you add yourself. If that service charges for what the key uses, you pay it directly. The key is used only to clip your videos.</p>
      </section>
      <section>
        <h2>No guarantee</h2>
        <p>The service is provided as it is. A video site may refuse a download, the AI may pick a moment you don&apos;t like, and clips are not guaranteed to get views or earnings. Keep your own copies of clips you care about.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>me@dealwithmuhammad.com</p>
      </section>
    </Legal>
  );
}
