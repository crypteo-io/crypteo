import { prisma } from "../db";

export interface BillingAlertData {
  holdSince: string | null;
  open: { id: string; amountDueUsd: number; dueAt: string | null; periodStart: string }[];
}

/** What the dashboard banner needs: the hold and the open invoices. */
export async function billingAlert(merchantId: string): Promise<BillingAlertData> {
  const [merchant, open] = await Promise.all([
    prisma.merchant.findUnique({ where: { id: merchantId }, select: { billingHoldAt: true } }),
    prisma.feeStatement.findMany({
      where: { merchantId, status: "open" },
      orderBy: { dueAt: "asc" },
      take: 12,
      select: { id: true, amountDueUsd: true, dueAt: true, periodStart: true },
    }),
  ]);
  return {
    holdSince: merchant?.billingHoldAt?.toISOString() ?? null,
    open: open.map((s) => ({
      id: s.id,
      amountDueUsd: s.amountDueUsd,
      dueAt: s.dueAt?.toISOString() ?? null,
      periodStart: s.periodStart.toISOString(),
    })),
  };
}
