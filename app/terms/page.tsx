import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { FEE_DUE_DAYS, feeCopy } from "@/lib/billing/fee-schedule";
import { getPublicFeeSchedule } from "@/lib/billing/settings";
import { pricingTiers } from "@/lib/content/pricing";
import Link from "next/link";

const LAST_UPDATED = "October 16, 2026";

// Rendered per request: the fee terms come from the admin's fee settings.
export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const fees = feeCopy(await getPublicFeeSchedule());
  return (
    <SiteShell>
      <PageHero
        eyebrow={<span className="eyebrow">Legal</span>}
        title="Terms of Service"
        subtitle={`Last updated: ${LAST_UPDATED}`}
      />

      <section className="pb-20 md:pb-28">
        <div className="container-site">
          <article className="prose-site mx-auto max-w-3xl">
            <p>
              These Terms of Service govern your use of Crypteo (&ldquo;Crypteo&rdquo;, &ldquo;we&rdquo;,
              &ldquo;us&rdquo;), including the website at crypteo.io, the merchant dashboard, the hosted
              checkout and the API. By creating an account or using the service you agree to these terms.
            </p>

            <h2>1. What Crypteo is</h2>
            <p>
              Crypteo is non-custodial payment monitoring and checkout software. You register public receiving
              addresses for your own wallets; we create payment sessions and payment links, show buyers a hosted
              checkout page, read public blockchain data to detect and confirm payments, and notify you by
              webhook and email.
            </p>
            <p>
              Crypteo never holds, receives, transmits or controls your funds. Buyers send payments directly from
              their wallet to yours. We never ask for, store or have access to your private keys or seed
              phrases.
            </p>

            <h2>2. Your account</h2>
            <p>
              You must give accurate information when you sign up and keep your login credentials, two-factor
              codes and API keys confidential. You are responsible for all activity under your account and API
              keys. Tell us promptly at <a href="mailto:support@crypteo.io">support@crypteo.io</a> if you believe
              your account or a key has been compromised, and revoke the key from the dashboard.
            </p>

            <h2>3. Your wallets and receiving addresses</h2>
            <p>
              You are solely responsible for the security of your wallets and private keys. Crypteo cannot
              recover funds lost to compromised keys, lost seed phrases or transactions sent on the wrong network.
            </p>
            <p>
              You are responsible for registering receiving addresses from <strong>self-custody wallets</strong>,
              wallets where you alone hold the keys. We strongly advise against using exchange deposit addresses:
              exchanges may hold, question or refuse incoming deposits, and some require their own destination tag
              or memo that conflicts with the one Crypteo assigns at checkout. You are also responsible for
              checking that every address you register is correct and belongs to the network it is registered
              for.
            </p>
            <p>
              Because Crypteo never controls any funds, <strong>we cannot recover, reverse or redirect</strong>{" "}
              payments sent to an exchange address, to an incorrect or mistyped address, to an address on the
              wrong network, or without a required tag or memo. Blockchain transactions are final.
            </p>

            <h2>4. Fees</h2>
            <p>
              Crypteo charges a platform fee on your paid payment volume. The rate is set by your volume in each
              billing month and applies to that whole month
              {fees.monthlyCap ? `, up to ${fees.monthlyCap} per billing month` : ""}:
            </p>
            <ul>
              {pricingTiers(fees).map((t) => (
                <li key={t.name}>
                  <strong>{t.name}</strong>: {t.rate} of volume, {t.volume.toLowerCase()}
                </li>
              ))}
            </ul>
            <p>
              Your billing month starts on the day of the month you created your account. Fees are calculated at
              the end of each billing month and paid in USDT or USDC. {fees.invoicing} An invoice is due{" "}
              {FEE_DUE_DAYS} days after it is issued; while it is overdue, new checkouts are paused until it is
              paid. Your dashboard and your funds are never affected: payments always go straight to your own
              wallet.
            </p>
            <p>
              There is no setup fee, monthly fee or minimum volume. Blockchain network fees are paid by the
              sender of each transaction and are not collected by Crypteo. Current rates are always published on
              the <Link href="/pricing">pricing page</Link>. We may change our fees with prior notice; changes
              do not apply to payments created before they take effect.
            </p>

            <h2>5. Acceptable use</h2>
            <p>You agree not to use Crypteo:</p>
            <ul>
              <li>to sell goods or services that are illegal where you or your buyers are located;</li>
              <li>for fraud, money laundering, terrorist financing or sanctions evasion;</li>
              <li>to probe, overload or interfere with the service or other merchants&apos; use of it;</li>
              <li>to misrepresent your business or the payments you request.</li>
            </ul>
            <p>
              You are responsible for complying with the laws that apply to your business, including tax,
              consumer-protection and anti-money-laundering obligations. We may suspend or close accounts that
              break these terms. Doing so ends your access to Crypteo&apos;s software; it never affects funds in
              your wallets, which we do not control.
            </p>

            <h2>6. Payment detection and accuracy</h2>
            <p>
              Crypteo relies on public blockchain data and third-party data providers to detect payments and on
              third-party price sources to convert amounts. We work to detect every payment promptly and
              accurately but do not guarantee that detection will be uninterrupted or error-free, or that every
              network will always be available. Before releasing high-value goods, you may verify a payment
              yourself in a block explorer.
            </p>

            <h2>7. API and webhooks</h2>
            <p>
              Your use of the API is subject to rate limits. You are responsible for verifying the signature on
              every webhook you receive and for handling repeated deliveries of the same event. Test-mode keys
              create test payments only and must not be relied on for real orders.
            </p>

            <h2>8. Disclaimers and limitation of liability</h2>
            <p>
              The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent
              permitted by law, Crypteo is not liable for indirect, incidental or consequential losses, for losses
              arising from blockchain networks, wallets or exchanges, or for funds sent to an address you
              registered. Our total liability for any claim is limited to the fees you paid Crypteo in the three
              months before the claim arose.
            </p>

            <h2>9. Ending your account</h2>
            <p>
              You can delete your account at any time from the dashboard. Payments already sent to your wallets
              are unaffected. Sections 3, 8 and any fees owed survive termination.
            </p>

            <h2>10. Changes to these terms</h2>
            <p>
              We may update these terms from time to time. We will post the new version on this page with a new
              &ldquo;last updated&rdquo; date and, for material changes, notify you by email. Continuing to use
              Crypteo after a change means you accept the updated terms.
            </p>

            <h2>11. Contact</h2>
            <p>
              Questions about these terms? Email <a href="mailto:support@crypteo.io">support@crypteo.io</a> or use
              the <Link href="/contact">contact form</Link>.
            </p>
          </article>
        </div>
      </section>
    </SiteShell>
  );
}
