import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import Link from "next/link";

const LAST_UPDATED = "October 16, 2026";

export default function PrivacyPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow={<span className="eyebrow">Legal</span>}
        title="Privacy Policy"
        subtitle={`Last updated: ${LAST_UPDATED}`}
      />

      <section className="pb-20 md:pb-28">
        <div className="container-site">
          <article className="prose-site mx-auto max-w-3xl">
            <p>
              Crypteo is a non-custodial payment gateway, so we collect as little as we can. We never have access
              to your private keys or your crypto, and we only collect the information needed to run checkout,
              your dashboard and our support. This policy explains what that is and what we do with it.
            </p>

            <h2>1. Information we collect</h2>
            <h3>Merchants</h3>
            <ul>
              <li>
                <strong>Account details:</strong> your name, email address, a hashed password and your two-factor
                settings.
              </li>
              <li>
                <strong>Configuration:</strong> the public wallet addresses you register, webhook URLs, payment
                links and API keys (stored so they can be verified and revoked).
              </li>
              <li>
                <strong>Payment records:</strong> the payment sessions you create, their amounts, statuses and the
                public transaction hashes that settled them, plus logs of the webhooks and emails we sent you.
              </li>
            </ul>
            <h3>Buyers</h3>
            <p>
              Buyers don&apos;t need an account. The checkout page records the payment session and the public
              on-chain transaction that pays it. We don&apos;t ask buyers for their name or email ourselves; if a
              merchant includes a customer email address when creating a payment, we store it with that payment
              on the merchant&apos;s behalf. Merchants are responsible for their own buyers&apos; privacy.
            </p>
            <h3>Visitors and contact form</h3>
            <p>
              If you contact us, we receive the name, email address and message you send, and keep them with the
              IP address the message came from so we can answer it and stop abuse. Like most websites, our servers
              process IP addresses to deliver pages and to rate-limit requests against abuse.
            </p>

            <h2>2. How we use it</h2>
            <p>
              We use this information to provide the service: to detect and confirm payments, send webhooks and
              email notifications, secure your account, answer support requests and improve Crypteo. We do not
              sell your personal information, and we do not use it for third-party advertising.
            </p>

            <h2>3. Blockchain data</h2>
            <p>
              Blockchain transactions are public and permanent. Your receiving addresses and every payment made to
              them can be seen by anyone with a block explorer, independently of Crypteo. We read this public data
              to confirm payments, but we do not control its visibility and cannot remove it.
            </p>

            <h2>4. Cookies</h2>
            <p>
              We use a session cookie to keep you signed in to the dashboard. It is strictly necessary for the
              service and isn&apos;t used for tracking.
            </p>

            <h2>5. Service providers</h2>
            <p>We share data only with providers that help us run Crypteo, and only as much as they need:</p>
            <ul>
              <li>hosting and database providers that store the service&apos;s data;</li>
              <li>an email delivery provider that sends account and payment notifications;</li>
              <li>
                Cloudflare Turnstile, which may check that sign-up, login and contact forms are used by a person;
              </li>
              <li>
                blockchain data and price providers, which receive the public addresses and transaction lookups
                needed to confirm payments, not your personal details.
              </li>
            </ul>
            <p>We may also disclose information where the law requires it.</p>

            <h2>6. Security and retention</h2>
            <p>
              Passwords are hashed, authenticator secrets are encrypted, and access to production data is
              restricted. We keep account and payment records while your account is active. When you delete your
              account, it is deactivated straight away; we may keep payment records for as long as we need them
              for legal, accounting or dispute purposes.
            </p>

            <h2>7. Your rights</h2>
            <p>
              You can view and update your account details in the dashboard and delete your account at any time.
              Depending on where you live, you may also have the right to access, correct, export or erase your
              personal data, or to object to how we process it. To make a request, email{" "}
              <a href="mailto:support@crypteo.io">support@crypteo.io</a>.
            </p>

            <h2>8. Changes to this policy</h2>
            <p>
              We may update this policy from time to time. We will post the new version here with a new
              &ldquo;last updated&rdquo; date and, for material changes, notify merchants by email.
            </p>

            <h2>9. Contact</h2>
            <p>
              Questions about privacy? Email <a href="mailto:support@crypteo.io">support@crypteo.io</a> or use the{" "}
              <Link href="/contact">contact form</Link>.
            </p>
          </article>
        </div>
      </section>
    </SiteShell>
  );
}
