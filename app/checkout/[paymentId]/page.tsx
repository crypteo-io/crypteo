import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutShell } from "@/components/checkout/CheckoutShell";
import {
  CheckoutSelectPayment,
  FUNDS_SEEN_STATUSES,
} from "@/components/checkout/types";
import { BRANDING_MERCHANT_SELECT, toCheckoutBranding } from "@/lib/branding";
import { onForeignHost } from "@/lib/custom-domain";
import { HOST_MERCHANT_SELECT } from "@/lib/custom-host";
import { prisma } from "@/lib/db";
import { canReassign, usdBase } from "@/lib/payment/assign";
import { offerableWallets, sessionWallets } from "@/lib/payment/wallets";
import { GRACE_PERIOD_MS } from "@/lib/payment/windows";
import { AvailableWallet } from "@/types/payment";
import { NOINDEX } from "@/lib/seo";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

// A buyer's own session: never listed in search results.
export const metadata: Metadata = { title: "Checkout", robots: NOINDEX };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { paymentId } = await params;
  const { edit } = await searchParams;
  const isEditing = edit === "true";

  // Select only what this public page needs; the full row would ship the
  // merchant's webhookUrl, customerEmail, externalId etc. into the page HTML.
  const paymentData = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      merchantId: true,
      status: true,
      chain: true,
      token: true,
      walletAddress: true,
      expectedAmount: true,
      receivedAmount: true,
      firstDetectedAt: true,
      txHash: true,
      expiresAt: true,
      metadata: true,
      isTest: true,
      cancelUrl: true,
      feeForStatementId: true,
      paymentLink: {
        select: { title: true, description: true, chain: true, token: true },
      },
      merchant: { select: { ...BRANDING_MERCHANT_SELECT, ...HOST_MERCHANT_SELECT } },
    },
  });

  if (!paymentData || (await onForeignHost(paymentData.merchant))) return notFound();

  // A session with no funds is gone once its late-deposit grace window has
  // closed; one where funds were seen stays reachable (see pay/page.tsx).
  const expiredAtMs = new Date(paymentData.expiresAt).getTime();
  if (
    expiredAtMs < Date.now() - GRACE_PERIOD_MS &&
    !FUNDS_SEEN_STATUSES.includes(paymentData.status)
  ) {
    return notFound();
  }

  const hasSelection = !!(
    paymentData.chain &&
    paymentData.token &&
    paymentData.walletAddress
  );

  // Editing is only offered while the session can still be re-pointed. Once
  // funds are seen, the status moves on, or the merchant fixed the network,
  // the PATCH would 409 — so don't render a selector that can only fail; show
  // the session's actual state instead. canReassign with no target pair asks
  // only whether any re-selection is possible (the same guard the PATCH runs).
  const reselectable = canReassign(paymentData, "", "").ok;

  // If selection is already made, skip to pay page (unless editing a session
  // that can still be edited)
  if (hasSelection && (!isEditing || !reselectable)) {
    return redirect(`/checkout/${paymentId}/pay`);
  }

  // If chain is not selected (or we are editing), fetch available wallets for this merchant
  let availableWallets: AvailableWallet[] = [];
  if (!paymentData.chain || isEditing) {
    const rawWallets = await prisma.wallet.findMany({
      where: {
        merchantId: paymentData.merchantId,
        isActive: true,
      },
      select: {
        chain: true,
        token: true,
        address: true,
        xrpTag: true,
      },
    });

    availableWallets = sessionWallets(offerableWallets(rawWallets), paymentData);

    console.log(
      `[Checkout] Found ${availableWallets.length} unique wallets for merchant ${paymentData.merchantId}`,
    );
  }

  const exchangeRates: Record<string, number> = {};
  if (availableWallets.length > 0) {
    const { getTokenPriceInUsd } = await import("@/lib/pricing");
    const uniqueTokens = Array.from(
      new Set(availableWallets.map((w) => w.token)),
    );
    // In parallel: one slow or fallback-bound price must not hold up the rest
    // of the page while it renders.
    await Promise.all(
      uniqueTokens.map(async (token) => {
        try {
          exchangeRates[token] = await getTokenPriceInUsd(token);
        } catch (e) {
          console.warn(`Failed to preload price for ${token}`, e);
          exchangeRates[token] = 0;
        }
      }),
    );
  }

  // The selector prices in USD. Only reachable for USD-based sessions (a
  // crypto-priced one is not reselectable and redirected above).
  const baseUsd = usdBase(paymentData) ?? paymentData.expectedAmount;

  const initialPayment: CheckoutSelectPayment = {
    id: paymentData.id,
    expectedAmount: baseUsd,
    expiresAt: paymentData.expiresAt.toISOString(),
    isTest: paymentData.isTest,
    paymentLink: paymentData.paymentLink
      ? {
          title: paymentData.paymentLink.title,
          description: paymentData.paymentLink.description,
        }
      : null,
    availableWallets,
    exchangeRates,
    cancelUrl: paymentData.cancelUrl,
  };

  const branding = toCheckoutBranding(paymentData.merchant);

  return (
    <CheckoutShell branding={branding}>
      <CheckoutClient
        initialPayment={initialPayment}
        merchantName={branding.name}
        merchantLogoUrl={branding.logoUrl}
      />
    </CheckoutShell>
  );
}
