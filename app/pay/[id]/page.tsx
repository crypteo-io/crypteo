import { CheckoutShell } from "@/components/checkout/CheckoutShell";
import {
  BRANDING_MERCHANT_SELECT,
  toCheckoutBranding,
  type CheckoutBranding,
} from "@/lib/branding";
import { PAID_STATUSES } from "@/lib/payment/status";
import { OG_SIZE } from "@/lib/og";
import { OG_CARDS } from "@/lib/og-cards";
import { NOINDEX, SITE_NAME } from "@/lib/seo";
import { customHostMerchant, hostMetadata, onForeignHost } from "@/lib/custom-domain";
import { HOST_MERCHANT_SELECT } from "@/lib/custom-host";
import { prisma } from "@/lib/db";
import {
  AssignmentFields,
  ORIGINAL_USD_KEY,
  resolveAssignment,
} from "@/lib/payment/assign";
import { clientIp, isRateLimitedByHeaders } from "@/lib/rate-limit";
import { isBotUserAgent } from "@/lib/security";
import { nowDate, nowMs } from "@/lib/time";
import crypto from "crypto";
import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Each GET of a link mints a polled session, and a pinned link also costs a
// chain balance read and a price fetch — a looped request against one link
// used to burn the shared RPC quota. Per IP, separate from the API bucket.
const PAY_LINK_LIMIT_PER_MIN = 20;

// A reload (or a re-opened tab) within this window reuses the visitor's
// still-untouched session instead of minting another.
const REUSE_WINDOW_MS = 5 * 60 * 1000;
// Don't hand back a session about to expire under the buyer.
const REUSE_MIN_REMAINING_MS = 45 * 60 * 1000;
// Metadata key holding the opaque visitor fingerprint used for reuse.
const CLIENT_KEY = "payLinkClient";

/**
 * Opaque, per-link visitor fingerprint: HMAC(link, IP, user agent). Keyed with
 * the server secret because metadata is visible to the merchant and a plain
 * hash of an IPv4 address is trivially reversible. Null disables reuse — no
 * secret, or no usable IP (every "unknown" visitor would share one session).
 *
 * The user agent narrows, but cannot rule out, two buyers behind one NAT
 * landing on the same session. That needs the same link, IP and exact browser
 * build within five minutes, and the shared session is still untouched; we
 * accept it over minting a fresh polled session per request.
 */
function visitorFingerprint(
  linkId: string,
  ip: string,
  userAgent: string | null,
): string | null {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || ip === "unknown") return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`${linkId}|${ip}|${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

/** A payment link that can't open a session right now, in the checkout's frame. */
function PayLinkNotice({
  id,
  title,
  branding,
  children,
}: {
  id: string;
  title: string;
  branding?: CheckoutBranding;
  children: React.ReactNode;
}) {
  return (
    <CheckoutShell branding={branding}>
      <div id={id} className="frame mx-auto max-w-lg bg-white/60 shadow-[0_24px_60px_rgba(6,15,22,0.08)]">
        <div className="frame-inner px-6 py-10 text-center sm:px-8">
          <h1 className="mb-3 text-2xl">{title}</h1>
          <p className="mx-auto max-w-sm text-default-600">{children}</p>
        </div>
      </div>
    </CheckoutShell>
  );
}

const PAY_LINK_IMAGE = { url: "/pay/opengraph-image", ...OG_SIZE, alt: OG_CARDS.checkout.title };

// One query per request, shared by the page and its share metadata.
const loadLink = cache((id: string) =>
  prisma.paymentLink.findUnique({
    where: { id },
    include: {
      merchant: { select: { isActive: true, ...BRANDING_MERCHANT_SELECT, ...HOST_MERCHANT_SELECT } },
    },
  }),
);

/**
 * What a shared payment link previews as: its title and the merchant's name.
 * Never indexed: a link belongs to one merchant's sale, not to search results.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const link = await loadLink((await params).id);
  if (!link || !link.isActive || !link.merchant.isActive) {
    return { ...(await hostMetadata("Payment link")), robots: NOINDEX };
  }
  const title = link.title || `Pay ${link.merchant.name}`;
  // On the merchant's own domain the platform's name appears nowhere.
  const ownDomain = !!(await customHostMerchant());
  const description =
    link.description || `Pay ${link.merchant.name} with crypto, straight to their own wallet on a secure checkout.`;
  return {
    title: ownDomain ? { absolute: title } : title,
    description,
    robots: NOINDEX,
    // Setting openGraph here replaces the inherited image (app/pay/opengraph-image.tsx), so name it.
    openGraph: {
      type: "website",
      siteName: ownDomain ? link.merchant.name : SITE_NAME,
      title,
      description,
      // The share card is Crypteo-branded, so a merchant's own domain shows none.
      images: ownDomain ? [] : [PAY_LINK_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PayLinkRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestHeaders = await headers();

  // 0. Per-IP rate limit, before any database or chain work.
  if (
    await isRateLimitedByHeaders(
      requestHeaders,
      "paylink",
      PAY_LINK_LIMIT_PER_MIN,
    )
  ) {
    return (
      <PayLinkNotice id="payment-link-rate-limited" title="Too Many Requests">
        Please wait a minute and reload this page.
      </PayLinkNotice>
    );
  }

  // 1. Fetch Payment Link
  const link = await loadLink(id);

  // A suspended merchant's links stop minting sessions; sessions already open
  // keep being watched, since buyers may have paid.
  if (!link || !link.isActive || !link.merchant.isActive || (await onForeignHost(link.merchant))) {
    return (
      <PayLinkNotice id="payment-link-unavailable" title="Payment Link Unavailable">
        This payment link has been deactivated or does not exist.
      </PayLinkNotice>
    );
  }

  const branding = toCheckoutBranding(link.merchant);

  // 2. Validate expiration
  if (link.expiresAt && new Date(link.expiresAt) < nowDate()) {
    return (
      <PayLinkNotice id="payment-link-expired" branding={branding} title="Payment Link Expired">
        This payment link is no longer valid as it has expired.
      </PayLinkNotice>
    );
  }

  // 3. Validate payment limit
  if (link.paymentLimit) {
    const paymentCount = await prisma.payment.count({
      where: {
        paymentLinkId: link.id,
        status: { in: [...PAID_STATUSES] },
      },
    });

    if (paymentCount >= link.paymentLimit) {
      return (
        <PayLinkNotice id="limit-reached" branding={branding} title="Limit Reached">
          This payment link has reached its maximum number of successful payments.
        </PayLinkNotice>
      );
    }
  }

  // 3b. Bot / link-unfurler guard.
  // This route mints a Payment session on GET. Chat-app link previews and
  // crawlers hitting the shared URL would each create a throwaway session, so
  // serve them a static preview instead of touching the database.
  const userAgent = requestHeaders.get("user-agent");
  if (isBotUserAgent(userAgent)) {
    return (
      <PayLinkNotice id="payment-link-preview" branding={branding} title={link.title || "Payment Request"}>
        {link.description || "Open this link in your browser to complete the payment."}
      </PayLinkNotice>
    );
  }

  // 3c. Reuse this visitor's recent session if nothing has happened on it
  // yet: still pending, nothing detected, fresh, and not close to expiry.
  // Anything that has seen funds is never reused.
  const now = nowMs();
  const fingerprint = visitorFingerprint(
    link.id,
    clientIp({ headers: requestHeaders }),
    userAgent,
  );
  if (fingerprint) {
    const recent = await prisma.payment.findFirst({
      where: {
        paymentLinkId: link.id,
        status: "pending",
        isTest: false,
        firstDetectedAt: null,
        OR: [{ receivedAmount: null }, { receivedAmount: 0 }],
        createdAt: { gte: new Date(now - REUSE_WINDOW_MS) },
        expiresAt: { gt: new Date(now + REUSE_MIN_REMAINING_MS) },
        metadata: { path: [CLIENT_KEY], equals: fingerprint },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (recent) redirect(`/checkout/${recent.id}`);
  }

  // 4. Create new Payment Session
  const expiresAt = new Date(now + 60 * 60 * 1000); // 1 hour checkout expiration

  // Payment link amounts are USD (the link form labels it "Amount (USD)").
  // Recording the base makes the session USD-denominated, so every chain
  // selection prices from it rather than from an already-converted figure.
  const metadata = {
    [ORIGINAL_USD_KEY]: link.amount,
    ...(fingerprint ? { [CLIENT_KEY]: fingerprint } : {}),
  };

  // A pinned chain/token is bound through the same assignment every other path
  // uses. Binding the wallet here without a snapshot used to count the wallet's
  // whole existing balance as the buyer's deposit (phantom "overpaid").
  let assigned: AssignmentFields | null = null;
  if (link.chain && link.token) {
    const assignment = await resolveAssignment({
      merchantId: link.merchantId,
      chain: link.chain,
      token: link.token,
      amount: { usd: link.amount },
      context: "payment_link",
    });
    if (assignment.ok) {
      assigned = assignment.fields;
    } else if (assignment.status === 503) {
      // Transient (chain or price feed unreachable): don't mint a session we
      // can't price or snapshot, and don't silently widen a pinned link to
      // other chains. Reloading retries.
      return (
        <PayLinkNotice id="payment-link-temporarily-unavailable" branding={branding} title="Temporarily Unavailable">
          We couldn&apos;t reach the payment network. No payment has been requested. Please reload this page in a moment.
        </PayLinkNotice>
      );
    } else {
      // The pinned pair can't be served (unsupported, no active wallet, or a
      // bad address). Fall back to an unassigned session so the buyer picks
      // from the merchant's working wallets — never chain set without wallet.
      console.warn(
        `[pay-link] ${link.id}: pinned ${link.chain}/${link.token} unavailable (${assignment.error}); falling back to buyer selection`,
      );
    }
  }

  const payment = await prisma.payment.create({
    data: {
      merchantId: link.merchantId,
      paymentLinkId: link.id,
      expectedAmount: link.amount,
      chain: null,
      token: null,
      walletAddress: null,
      // The link's webhook destination: its custom URL or chosen endpoint;
      // neither means the merchant's default (lib/payment/notify.ts).
      webhookUrl: link.webhookUrl,
      webhookEndpointId: link.webhookUrl ? null : link.webhookEndpointId,
      ...(assigned ?? {}),
      metadata,
      status: "pending",
      expiresAt,
      pollInterval: 15,
      pollPhase: "phase1",
      nextPollAt: new Date(now + 15000),
    },
  });

  // 5. Redirect to checkout
  redirect(`/checkout/${payment.id}`);
}
