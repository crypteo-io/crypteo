/**
 * Platform fees: a statement per merchant per billing month. What is owed
 * carries forward until it reaches the minimum, then is invoiced every three
 * billing months, or at the month's close once it reaches the monthly
 * threshold (shouldInvoice). Paid in USDT/USDC through a hosted checkout on the
 * platform's billing account, and enforced by a billing hold once overdue.
 *
 * Billing months are each merchant's own (lib/billing/cycle.ts): anchored on
 * the day their account was created, so closes are spread through the month
 * rather than all landing on the 1st.
 *
 * Every paid live sale is billed exactly once: the close stamps each payment
 * with its statement (billedInStatementId) before summing, so a sale that
 * settles after its cycle was closed is picked up by the next close, and a
 * re-run never bills a sale twice.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getTokenPriceInUsd } from "../pricing";
import { classifyAmount } from "../chains/config";
import { isPaidStatus, PAID_STATUSES } from "../payment/status";
import { KNOWN_USD_SQL } from "../payment/usd-value";
import { anchorDayOf, cycleContaining, lastCompletedCycle, monthsSpanned } from "./cycle";
import { FEE_DUE_DAYS, monthlyFee, roundCents, shouldInvoice, type FeeSchedule } from "./fee-schedule";
import { getPlatformSettings } from "./settings";
import { DAY_MS } from "../time";

export const STATEMENT_STATUSES = ["draft", "carried", "open", "paid", "waived"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

// Upper bounds on one billing run; anything left over is the next run's.
const MAX_MERCHANTS_PER_CLOSE = 5_000;
const MAX_STATEMENTS_PER_PASS = 1_000;

/** The columns the admin statement tables render. */
export const STATEMENT_ADMIN_SELECT = {
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
  note: true,
  resolvedBy: true,
} as const satisfies Prisma.FeeStatementSelect;

/** Accounts never charged: admins, the billing account, exempt and inactive ones. */
function billableMerchantWhere(billingMerchantId: string | null): Prisma.MerchantWhereInput {
  return {
    isActive: true,
    feeExempt: false,
    role: "merchant",
    ...(billingMerchantId ? { id: { not: billingMerchantId } } : {}),
  };
}

/** Sales not yet billed, created from feesStartAt up to the cycle's end. */
function unbilledSalesWhere(from: Date, periodEnd: Date): Prisma.PaymentWhereInput {
  return {
    isTest: false,
    status: { in: [...PAID_STATUSES] },
    billedInStatementId: null,
    feeForStatementId: null,
    createdAt: { gte: from, lt: periodEnd },
  };
}

/** Billing starts at the later of the platform switch-on and the merchant's own start. */
export function billableFrom(feesStartAt: Date, merchantFrom: Date | null): Date {
  return merchantFrom && merchantFrom > feesStartAt ? merchantFrom : feesStartAt;
}

/**
 * What the statement for this volume and carry owes, and whether it's
 * invoiced, given the billing months it has accrued over (its own included).
 */
export function statementOutcome(
  schedule: FeeSchedule,
  volumeUsd: number,
  carriedInUsd: number,
  monthsAccrued: number,
): { ratePercent: number; feeUsd: number; amountDueUsd: number; invoice: boolean } {
  const { ratePercent, feeUsd } = monthlyFee(schedule, volumeUsd);
  const amountDueUsd = roundCents(feeUsd + carriedInUsd);
  return {
    ratePercent,
    feeUsd,
    amountDueUsd,
    invoice: shouldInvoice(schedule, amountDueUsd, monthsAccrued),
  };
}

export interface CloseReport {
  skipped?: string;
  created: number;
  invoiced: number;
  errors: { merchantId: string; error: string }[];
}

/**
 * Close every billing month that has ended: for each billable merchant with
 * unbilled sales or a carried balance, the statement for their last completed
 * cycle. Idempotent: a cycle that already has its statement is skipped, and
 * stamped sales are never re-billed. Runs hourly, so a cycle closes within an
 * hour of its end.
 */
export async function closeDueCycles(now: Date = new Date()): Promise<CloseReport> {
  const report: CloseReport = { created: 0, invoiced: 0, errors: [] };
  const settings = await getPlatformSettings({ fresh: true });
  if (!settings.billingEnabled || !settings.feesStartAt) {
    return { ...report, skipped: "billing is disabled" };
  }
  const feesStartAt = settings.feesStartAt;
  const merchantWhere = billableMerchantWhere(settings.billingMerchantId);
  // Sales up to now: each merchant's own cycle end narrows it below.
  const anySales = unbilledSalesWhere(feesStartAt, now);
  const [withSales, withCarry] = await Promise.all([
    prisma.payment.groupBy({
      by: ["merchantId"],
      where: { ...anySales, merchant: merchantWhere },
      take: MAX_MERCHANTS_PER_CLOSE,
      orderBy: { merchantId: "asc" },
    }),
    prisma.feeStatement.findMany({
      where: { status: "carried", carriedIntoId: null, amountDueUsd: { gt: 0 } },
      select: { merchantId: true },
      distinct: ["merchantId"],
      take: MAX_MERCHANTS_PER_CLOSE,
    }),
  ]);
  const candidateIds = [
    ...new Set([...withSales.map((s) => s.merchantId), ...withCarry.map((c) => c.merchantId)]),
  ];
  if (candidateIds.length === 0) return report;
  const merchants = await prisma.merchant.findMany({
    where: { id: { in: candidateIds }, ...merchantWhere },
    select: { id: true, createdAt: true, feesFromAt: true },
  });
  const carrying = new Set(withCarry.map((c) => c.merchantId));

  for (const m of merchants) {
    try {
      const cycle = lastCompletedCycle(anchorDayOf(m.createdAt), now);
      // Billing started after this cycle ended: nothing of it is billable yet.
      const from = billableFrom(feesStartAt, m.feesFromAt);
      if (cycle.end.getTime() <= from.getTime()) continue;
      const sales = unbilledSalesWhere(from, cycle.end);
      const exists = await prisma.feeStatement.findUnique({
        where: { merchantId_periodStart: { merchantId: m.id, periodStart: cycle.start } },
        select: { id: true },
      });
      if (exists) continue;
      if (!carrying.has(m.id) && (await prisma.payment.count({ where: { ...sales, merchantId: m.id } })) === 0) {
        continue;
      }
      const statementId = await openDraft(m.id, cycle.start, cycle.end, sales);
      if (!statementId) continue;
      report.created++;
      if ((await finalizeStatement(statementId, now)) === "open") report.invoiced++;
    } catch (error) {
      console.error(`[billing] close failed for ${m.id}:`, error);
      report.errors.push({
        merchantId: m.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

/**
 * Create the cycle's statement and stamp its sales, in one transaction.
 * Null when the merchant already has one for the cycle.
 */
async function openDraft(
  merchantId: string,
  periodStart: Date,
  periodEnd: Date,
  sales: Prisma.PaymentWhereInput,
): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const statement = await tx.feeStatement.create({
        data: {
          merchantId,
          periodStart,
          periodEnd,
          paymentCount: 0,
          volumeUsd: 0,
          ratePercent: 0,
          feeUsd: 0,
          amountDueUsd: 0,
          status: "draft",
        },
        select: { id: true },
      });
      await tx.payment.updateMany({
        where: { ...sales, merchantId },
        data: { billedInStatementId: statement.id },
      });
      return statement.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

/**
 * Sum a draft's stamped sales, roll in carried balances, and settle its status.
 * Sales priced in a volatile token have no recorded USD value and are valued
 * at the current price: a price that can't be read leaves the statement a
 * draft for the next run rather than billing a guessed figure.
 */
class StatementRaceError extends Error {}

async function finalizeStatement(
  statementId: string,
  now: Date = new Date(),
): Promise<StatementStatus | null> {
  const settings = await getPlatformSettings({ fresh: true });
  const rows = await prisma.$queryRaw<
    { token: string | null; count: bigint; known: number | null; unknownAmount: number | null }[]
  >`
    SELECT lower(p."token") AS token,
           COUNT(*) AS count,
           SUM(${KNOWN_USD_SQL}) AS known,
           SUM(CASE WHEN ${KNOWN_USD_SQL} IS NULL THEN p."expectedAmount" END) AS "unknownAmount"
      FROM "Payment" p
     WHERE p."billedInStatementId" = ${statementId}
     GROUP BY lower(p."token")`;

  let volumeUsd = 0;
  let paymentCount = 0;
  for (const row of rows) {
    paymentCount += Number(row.count);
    volumeUsd += row.known ?? 0;
    if (row.unknownAmount) {
      if (!row.token) throw new Error("a billed sale has no token");
      volumeUsd += row.unknownAmount * (await getTokenPriceInUsd(row.token));
    }
  }
  volumeUsd = roundCents(volumeUsd);

  return finalizeTx(statementId, volumeUsd, paymentCount, settings.schedule, now).catch((error) => {
    if (error instanceof StatementRaceError) return null;
    throw error;
  });
}

function finalizeTx(
  statementId: string,
  volumeUsd: number,
  paymentCount: number,
  schedule: FeeSchedule,
  now: Date,
): Promise<StatementStatus | null> {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.feeStatement.findUnique({
      where: { id: statementId },
      select: { merchantId: true, status: true, periodStart: true, periodEnd: true },
    });
    if (draft?.status !== "draft") return null;
    const carried = await tx.feeStatement.findMany({
      where: {
        merchantId: draft.merchantId,
        status: "carried",
        carriedIntoId: null,
        id: { not: statementId },
      },
      select: { id: true, amountDueUsd: true, periodStart: true, accruingSince: true },
    });
    const carriedInUsd = roundCents(carried.reduce((s, c) => s + c.amountDueUsd, 0));
    // The oldest carried month starts the invoice's 3-month clock; a carry
    // of $0 owes nothing, so it doesn't.
    const accruingSince = carried
      .filter((c) => c.amountDueUsd > 0)
      .map((c) => c.accruingSince ?? c.periodStart)
      .reduce((a, b) => (b < a ? b : a), draft.periodStart);
    const outcome = statementOutcome(
      schedule,
      volumeUsd,
      carriedInUsd,
      monthsSpanned(accruingSince, draft.periodEnd),
    );
    if (carried.length) {
      await tx.feeStatement.updateMany({
        where: { id: { in: carried.map((c) => c.id) } },
        data: { carriedIntoId: statementId },
      });
    }
    const status: StatementStatus = outcome.invoice ? "open" : "carried";
    // Compare-and-set on "draft": a concurrent finalize that got here first
    // makes this one roll back, carried links included.
    const { count } = await tx.feeStatement.updateMany({
      where: { id: statementId, status: "draft" },
      data: {
        paymentCount,
        volumeUsd,
        ratePercent: outcome.ratePercent,
        feeUsd: outcome.feeUsd,
        carriedInUsd,
        accruingSince,
        amountDueUsd: outcome.amountDueUsd,
        status,
        ...(outcome.invoice
          ? { issuedAt: now, dueAt: new Date(now.getTime() + FEE_DUE_DAYS * DAY_MS) }
          : {}),
      },
    });
    if (count !== 1) throw new StatementRaceError();
    return status;
  });
}

/** Drafts a failed price read (or a crash) left behind. */
export async function finalizeDrafts(now: Date = new Date()): Promise<number> {
  const drafts = await prisma.feeStatement.findMany({
    where: { status: "draft" },
    select: { id: true },
    take: MAX_STATEMENTS_PER_PASS,
  });
  let done = 0;
  for (const d of drafts) {
    try {
      if (await finalizeStatement(d.id, now)) done++;
    } catch (error) {
      console.error(`[billing] statement ${d.id} still can't be finalized:`, error);
    }
  }
  return done;
}

/**
 * Mark open statements paid once one of their fee checkouts is paid in full,
 * on time or late. A fee checkout that ends short is left for an admin.
 */
export async function settleFeePayments(now: Date = new Date()): Promise<string[]> {
  const open = await prisma.feeStatement.findMany({
    where: { status: "open" },
    select: { id: true },
    take: MAX_STATEMENTS_PER_PASS,
  });
  if (open.length === 0) return [];
  const candidates = await prisma.payment.findMany({
    where: {
      feeForStatementId: { in: open.map((s) => s.id) },
      status: { in: [...PAID_STATUSES, "expired_received"] },
    },
    select: { id: true, feeForStatementId: true, status: true, receivedAmount: true, expectedAmount: true },
  });
  // A transfer that landed after its checkout expired still pays the invoice
  // when it was in full; leaving the merchant on hold until an admin noticed
  // would block checkouts that had already paid.
  const paid = candidates.filter(
    (p) =>
      isPaidStatus(p.status) ||
      classifyAmount(p.receivedAmount ?? 0, p.expectedAmount) !== "underpaid",
  );
  const settled: string[] = [];
  for (const p of paid) {
    const statementId = p.feeForStatementId;
    if (!statementId) continue;
    const { count } = await prisma.feeStatement.updateMany({
      where: { id: statementId, status: "open" },
      data: { status: "paid", paidAt: now, paidPaymentId: p.id },
    });
    if (count) settled.push(statementId);
  }
  return settled;
}

/**
 * Hold every merchant with an overdue open statement; returns the newly held.
 * The hold blocks binding a checkout to a network (resolveAssignment), not the
 * dashboard: the merchant has to sign in to pay.
 */
export async function placeBillingHolds(now: Date = new Date()): Promise<string[]> {
  const overdue = await prisma.feeStatement.findMany({
    where: { status: "open", dueAt: { lte: now } },
    select: { merchantId: true },
    distinct: ["merchantId"],
    take: MAX_STATEMENTS_PER_PASS,
  });
  const held: string[] = [];
  for (const { merchantId } of overdue) {
    const { count } = await prisma.merchant.updateMany({
      where: { id: merchantId, billingHoldAt: null },
      data: { billingHoldAt: now },
    });
    if (count) held.push(merchantId);
  }
  return held;
}

/** Lift the hold of every merchant with nothing overdue; returns the lifted. */
export async function liftBillingHolds(
  now: Date = new Date(),
  merchantIds?: string[],
): Promise<string[]> {
  const held = await prisma.merchant.findMany({
    where: { billingHoldAt: { not: null }, ...(merchantIds ? { id: { in: merchantIds } } : {}) },
    select: { id: true },
    take: MAX_STATEMENTS_PER_PASS,
  });
  const lifted: string[] = [];
  for (const { id } of held) {
    const stillOverdue = await prisma.feeStatement.count({
      where: { merchantId: id, status: "open", dueAt: { lte: now } },
    });
    if (stillOverdue) continue;
    const { count } = await prisma.merchant.updateMany({
      where: { id, billingHoldAt: { not: null } },
      data: { billingHoldAt: null },
    });
    if (count) lifted.push(id);
  }
  return lifted;
}

/**
 * The current billing month's fees so far, for the merchant's Billing page:
 * sales with a recorded USD value only (volatile-token sales are priced at
 * the close and counted separately here), before carry and minimum.
 */
export async function estimateCycleToDate(
  merchant: { id: string; createdAt: Date; feesFromAt: Date | null },
  now: Date = new Date(),
): Promise<{
  cycleStart: Date;
  cycleEnd: Date;
  volumeUsd: number;
  unpriced: number;
  ratePercent: number;
  feeUsd: number;
} | null> {
  const settings = await getPlatformSettings();
  if (!settings.billingEnabled || !settings.feesStartAt) return null;
  const cycle = cycleContaining(anchorDayOf(merchant.createdAt), now);
  const start = billableFrom(settings.feesStartAt, merchant.feesFromAt);
  const from = start > cycle.start ? start : cycle.start;
  const [row] = await prisma.$queryRaw<{ known: number | null; unpriced: bigint }[]>`
    SELECT SUM(${KNOWN_USD_SQL}) AS known,
           COUNT(*) FILTER (WHERE ${KNOWN_USD_SQL} IS NULL) AS unpriced
      FROM "Payment" p
     WHERE p."merchantId" = ${merchant.id}
       AND p."isTest" = false
       AND p."status" IN (${Prisma.join([...PAID_STATUSES])})
       AND p."billedInStatementId" IS NULL
       AND p."feeForStatementId" IS NULL
       AND p."createdAt" >= ${from}`;
  const volumeUsd = roundCents(row?.known ?? 0);
  return {
    cycleStart: cycle.start,
    cycleEnd: cycle.end,
    volumeUsd,
    unpriced: Number(row?.unpriced ?? 0),
    ...monthlyFee(settings.schedule, volumeUsd),
  };
}
