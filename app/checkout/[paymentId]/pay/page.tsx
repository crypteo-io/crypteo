import { CheckoutShell } from "@/components/checkout/CheckoutShell";
import { PayClient } from "@/components/checkout/PayClient";
import {
  CHECKOUT_PAYMENT_SELECT,
  CheckoutPayment,
  FUNDS_SEEN_STATUSES,
} from "@/components/checkout/types";
import { BRANDING_MERCHANT_SELECT, toCheckoutBranding } from "@/lib/branding";
import { hostMetadata, onForeignHost } from "@/lib/custom-domain";
import { HOST_MERCHANT_SELECT } from "@/lib/custom-host";
import { prisma } from "@/lib/db";
import { canReassign, usdBase } from "@/lib/payment/assign";
import { GRACE_PERIOD_MS } from "@/lib/payment/windows";
import { nowMs } from "@/lib/time";
import { NOINDEX } from "@/lib/seo";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

// A buyer's own session: never listed in search results.
export async function generateMetadata(): Promise<Metadata> {
  return { ...(await hostMetadata("Checkout")), robots: NOINDEX };
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;

  // Request-time clock, used for every time-based decision on this page and
  // shared with PayClient so its first render (expired or live) matches this
  // server render exactly.
  const renderedAt = nowMs();

  // One read serves both the buyer UI and the re-selection guard below. The
  // guard-only fields (metadata, firstDetectedAt, the link's pinned pair) are
  // evaluated here and never passed to the client: this page is public.
  const row = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      ...CHECKOUT_PAYMENT_SELECT,
      firstDetectedAt: true,
      metadata: true,
      paymentLink: {
        select: { title: true, description: true, chain: true, token: true },
      },
      merchant: { select: { ...BRANDING_MERCHANT_SELECT, ...HOST_MERCHANT_SELECT } },
    },
  });

  if (!row || (await onForeignHost(row.merchant))) return notFound();

  // Whether the buyer may go back and pick another network — the same guard
  // the PATCH enforces. Only the answer reaches the client.
  const canChangeNetwork = canReassign(row, "", "", new Date(renderedAt)).ok;
  // The order's USD price for the summary panel; null for crypto-priced
  // sessions. Read from metadata here so metadata itself stays server-side.
  const amountUsd = usdBase(row);

  // Whitelist back down to CHECKOUT_PAYMENT_SELECT's shape: copy exactly its
  // keys, so a guard-only field added to the query can't leak by default. The
  // link is narrowed separately — its pinned chain/token are guard inputs.
  const { paymentLink, merchant, ...scalars } = row;
  const payment = {
    ...(Object.fromEntries(
      Object.keys(CHECKOUT_PAYMENT_SELECT)
        .filter((k) => k !== "paymentLink")
        .map((k) => [k, scalars[k as keyof typeof scalars]]),
    ) as Omit<typeof scalars, "firstDetectedAt" | "metadata">),
    paymentLink: paymentLink
      ? { title: paymentLink.title, description: paymentLink.description }
      : null,
  };

  // A session with no funds is gone once its late-deposit grace window has
  // closed. Anything where funds were seen stays reachable indefinitely — a
  // buyer reloading a confirming/underpaid session must see its state, not 404.
  const expiredAtMs = new Date(payment.expiresAt).getTime();
  if (
    expiredAtMs < renderedAt - GRACE_PERIOD_MS &&
    !FUNDS_SEEN_STATUSES.includes(payment.status)
  ) {
    return notFound();
  }

  // If no chain/token selected yet, redirect back to selection
  if (!payment.chain || !payment.token || !payment.walletAddress) {
    return redirect(`/checkout/${paymentId}`);
  }

  // Ensure JSON serializability for the client component
  const initialPayment: CheckoutPayment = JSON.parse(JSON.stringify(payment));

  const branding = toCheckoutBranding(merchant);

  return (
    <CheckoutShell branding={branding}>
      <PayClient
        initialPayment={initialPayment}
        merchantName={merchant.name}
        merchantLogoUrl={branding.logoUrl}
        amountUsd={amountUsd}
        canChangeNetwork={canChangeNetwork}
        initialNow={renderedAt}
      />
    </CheckoutShell>
  );
}
