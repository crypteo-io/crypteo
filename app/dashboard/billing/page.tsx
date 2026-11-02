import { BillingClient } from "@/components/billing/BillingClient";
import { auth } from "@/lib/auth";
import { anchorDayOf } from "@/lib/billing/cycle";
import { feeCopy } from "@/lib/billing/fee-schedule";
import { getPlatformSettings } from "@/lib/billing/settings";
import { estimateCycleToDate } from "@/lib/billing/statements";
import { prisma } from "@/lib/db";
import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Billing",
  description: "Your platform fees, invoices and payments.",
};

const STATEMENTS_SHOWN = 24;

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const merchantId = session.user.id;

  const [merchant, settings, statements, carried] = await Promise.all([
    prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, createdAt: true, feesFromAt: true, role: true, feeExempt: true, billingHoldAt: true },
    }),
    getPlatformSettings(),
    prisma.feeStatement.findMany({
      where: { merchantId, status: { not: "draft" } },
      orderBy: { periodStart: "desc" },
      take: STATEMENTS_SHOWN,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        paymentCount: true,
        volumeUsd: true,
        ratePercent: true,
        feeUsd: true,
        carriedInUsd: true,
        accruingSince: true,
        amountDueUsd: true,
        status: true,
        issuedAt: true,
        dueAt: true,
        paidAt: true,
      },
    }),
    prisma.feeStatement.findFirst({
      where: { merchantId, status: "carried", carriedIntoId: null, amountDueUsd: { gt: 0 } },
      orderBy: { periodStart: "desc" },
      select: { amountDueUsd: true },
    }),
  ]);
  const exempt = !merchant || merchant.feeExempt || merchant.role !== "merchant";
  const estimate = exempt || !merchant ? null : await estimateCycleToDate(merchant).catch(() => null);

  return (
    <BillingClient
      data={JSON.parse(
        JSON.stringify({
          now: new Date(),
          exempt,
          anchorDay: merchant ? anchorDayOf(merchant.createdAt) : null,
          billingEnabled: settings.billingEnabled,
          holdSince: merchant?.billingHoldAt ?? null,
          copy: feeCopy(settings.schedule),
          estimate,
          carriedUsd: carried?.amountDueUsd ?? 0,
          statements,
        }),
      )}
    />
  );
}
