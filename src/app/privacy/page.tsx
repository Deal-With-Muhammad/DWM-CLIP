import { Legal } from "@/components/legal";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <Legal title="Privacy" updated="18 November 2026">
      <section>
        <h2>What is stored</h2>
        <p>Your email address (to sign you in), the video links you paste, the clips made from them, and how many clips you&apos;ve made. If you add an AI key, it is stored encrypted and never shown again. If you pay, Paddle (our reseller and Merchant of Record) handles the card and your billing details; this site only learns that you have a subscription.</p>
      </section>
      <section>
        <h2>Who else sees it</h2>
        <p>
          Cloudflare hosts the site, the database and your clips. The words spoken in a video you clip are sent to an AI service to choose the moments: Google Gemini on Pro, or the service whose key you added on the free plan. Sign-in emails are sent through
          Gmail. Nothing is sold or used for advertising.
        </p>
      </section>
      <section>
        <h2>Cookies</h2>
        <p>One cookie keeps you signed in. There are no advertising or tracking cookies. Paddle sets its own cookies inside its checkout when you pay.</p>
      </section>
      <section>
        <h2>Deleting your data</h2>
        <p>Delete any clip or video from the app and its files are removed straight away. To delete your whole account, email me@dealwithmuhammad.com from the address you signed up with.</p>
      </section>
    </Legal>
  );
}
