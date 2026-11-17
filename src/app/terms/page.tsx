import { Legal } from "@/components/legal";
import { FREE, PRO, formatBytes } from "@/lib/plans";

export const metadata = { title: "Terms" };

export default function Terms() {
  return (
    <Legal title="Terms" updated="18 November 2026">
      <section>
        <h2>What DWM Clip is</h2>
        <p>DWM Clip turns a video you give it a link to into short vertical clips. It is run by Muhammad Ahmad (dealwithmuhammad.com). By using it you agree to these terms.</p>
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
          Free: {FREE.clips} clips with your own AI key and {formatBytes(FREE.storage)} of storage. Pro: {PRO.clips} clips a month and {formatBytes(PRO.storage)} of storage, billed monthly until cancelled. Limits may change; a change never shortens a month you
          already paid for.
        </p>
      </section>
      <section>
        <h2>Payments and refunds</h2>
        <p>Payments are handled by Lemon Squeezy, who is the seller of record. You can cancel any time from Settings and keep Pro until the end of the paid month. If something didn&apos;t work, email within 7 days of the charge and you&apos;ll get a refund.</p>
      </section>
      <section>
        <h2>Your AI key</h2>
        <p>If you add your own AI key, you pay that service directly for what it uses. The key is used only to clip your videos.</p>
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
