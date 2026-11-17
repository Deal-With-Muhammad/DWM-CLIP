import { Legal } from "@/components/legal";

export const metadata = { title: "Refund policy" };

export default function Refund() {
  return (
    <Legal title="Refund policy" updated="18 November 2026">
      <section>
        <h2>14-day refund</h2>
        <p>If DWM Clip Pro or extra storage didn&apos;t work for you, ask within 14 days of a payment and that payment is refunded in full. You don&apos;t need to give a reason.</p>
      </section>
      <section>
        <h2>How to ask</h2>
        <p>
          Email me@dealwithmuhammad.com from the address you signed up with, or reply to the receipt Paddle sent you. Refunds are issued by Paddle, our reseller and Merchant of Record, to the payment method you used, usually within 5 to 10 working days.
        </p>
      </section>
      <section>
        <h2>Cancelling</h2>
        <p>You can cancel a subscription any time from Settings. It stays active until the end of the month already paid for and isn&apos;t charged again. Cancelling doesn&apos;t delete your clips.</p>
      </section>
      <section>
        <h2>After 14 days</h2>
        <p>Payments older than 14 days aren&apos;t refunded, except where the law in your country gives you that right or the service was unavailable for most of the period you paid for.</p>
      </section>
    </Legal>
  );
}
