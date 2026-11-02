import { RevenueClient } from "@/components/billing/RevenueClient";
import { adminPageSession } from "@/lib/admin";
import { getPlatformSettings } from "@/lib/billing/settings";
import { STATEMENT_ADMIN_SELECT } from "@/lib/billing/statements";
import { prisma } from "@/lib/db";
import { Metadata } from "next";
import { DAY_MS } from "@/lib/time";

export const metadata: Metadata = {
  title: "Revenue",
  description: "Platform fees, invoices and billing settings (Admin only).",
};

const STATEMENTS_SHOWN = 300;

export default async function RevenuePage() {
  await adminPageSession();
  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [settings, admins, byStatus, overdue, collected30d, held, statements, billingWallets, carried, exempt] =
    await Promise.all([
      getPlatformSettings({ fresh: true }),
      prisma.merchant.findMany({
        where: { role: "admin", isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.feeStatement.groupBy({
        by: ["status"],
        _sum: { amountDueUsd: true },
        _count: { _all: true },
      }),
      prisma.feeStatement.aggregate({
        where: { status: "open", dueAt: { lte: now } },
        _sum: { amountDueUsd: true },
        _count: { _all: true },
      }),
      prisma.feeStatement.aggregate({
        where: { status: "paid", paidAt: { gte: since30d } },
        _sum: { amountDueUsd: true },
      }),
      prisma.merchant.count({ where: { billingHoldAt: { not: null } } }),
      prisma.feeStatement.findMany({
        where: { status: { not: "draft" } },
        orderBy: [{ createdAt: "desc" }],
        take: STATEMENTS_SHOWN,
        select: { ...STATEMENT_ADMIN_SELECT, merchant: { select: { id: true, name: true, email: true } } },
      }),
      prisma.wallet.findMany({
        where: { isActive: true, token: { in: ["usdt", "usdc"] }, merchant: { role: "admin" } },
        select: { merchantId: true, chain: true, token: true },
      }),
      // Only balances still waiting to roll into a statement; rolled ones are
      // already inside a later statement's amount.
      prisma.feeStatement.aggregate({
        where: { status: "carried", carriedIntoId: null },
        _sum: { amountDueUsd: true },
      }),
      prisma.merchant.findMany({
        where: { feeExempt: true, role: "merchant" },
        select: { id: true, name: true, email: true, feeExemptReason: true, feeExemptBy: true, feeExemptAt: true },
        orderBy: { feeExemptAt: "desc" },
        take: 500,
      }),
    ]);

  const sum = (status: string) => byStatus.find((s) => s.status === status)?._sum.amountDueUsd ?? 0;
  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;

  return (
    <RevenueClient
      data={JSON.parse(
        JSON.stringify({
          now,
          settings: {
            tiers: settings.schedule.tiers,
            monthlyCapUsd: settings.schedule.monthlyCapUsd,
            minInvoiceUsd: settings.schedule.minInvoiceUsd,
            monthlyInvoiceUsd: settings.schedule.monthlyInvoiceUsd,
            invoiceEveryMonths: settings.schedule.invoiceEveryMonths,
            billingEnabled: settings.billingEnabled,
            feesStartAt: settings.feesStartAt,
            billingMerchantId: settings.billingMerchantId,
            updatedAt: settings.updatedAt,
            updatedBy: settings.updatedBy,
          },
          admins: admins.map((a) => ({
            ...a,
            feeWallets: billingWallets
              .filter((w) => w.merchantId === a.id)
              .map((w) => `${w.token.toUpperCase()} · ${w.chain.toUpperCase()}`),
          })),
          kpis: {
            outstanding: sum("open"),
            openCount: count("open"),
            overdue: overdue._sum.amountDueUsd ?? 0,
            overdueCount: overdue._count._all,
            collected: sum("paid"),
            collected30d: collected30d._sum.amountDueUsd ?? 0,
            waived: sum("waived"),
            carried: carried._sum.amountDueUsd ?? 0,
            held,
          },
          statements,
          exempt,
        }),
      )}
    />
  );
}
