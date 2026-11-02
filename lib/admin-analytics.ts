import { Prisma } from "@prisma/client";
import { DELETED_EMAIL_DOMAIN } from "./account-state";
import { prisma } from "./db";
import { PAID_STATUSES } from "./payment/status";
import { KNOWN_USD_SQL } from "./payment/usd-value";
import { DAY_MS } from "./time";

// Platform analytics for admins. Every query is bounded by a date window and
// counts live merchant sales only: test payments and the platform's own fee
// checkouts are excluded. USD figures are sales with a known USD value (see
// lib/payment/usd-value.ts); the rest are counted as "unpriced", never guessed.

const ANALYTICS_MONTHS = 12;
const ANALYTICS_DAYS = 30;
const TOP_MERCHANTS = 10;

const LIVE_SALES = Prisma.sql`p."isTest" = false AND p."feeForStatementId" IS NULL`;
const PAID = Prisma.sql`p."status" IN (${Prisma.join([...PAID_STATUSES])})`;

export interface PlatformAnalytics {
  generatedAt: string;
  merchants: {
    total: number;
    active: number;
    suspended: number;
    onHold: number;
    exempt: number;
    new30d: number;
    withSales30d: number;
  };
  window: {
    sessions: number;
    paid: number;
    paidUsd: number;
    unpriced: number;
    /** Paid ÷ sessions that reached an outcome (paid, expired, underpaid, late). */
    conversion: number | null;
    averageUsd: number | null;
    statusCounts: { status: string; count: number }[];
  };
  monthly: { month: string; paid: number; paidUsd: number; sessions: number; feesCollected: number }[];
  daily: { day: string; paid: number; paidUsd: number }[];
  byNetwork: { chain: string; token: string; paid: number; paidUsd: number; amount: number }[];
  topMerchants: { id: string; name: string; email: string; paid: number; paidUsd: number }[];
}

export async function platformAnalytics(now: Date = new Date()): Promise<PlatformAnalytics> {
  const since = new Date(now.getTime() - ANALYTICS_DAYS * DAY_MS);
  const monthsFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (ANALYTICS_MONTHS - 1), 1));
  const notDeleted = { email: { not: { endsWith: DELETED_EMAIL_DOMAIN } } };

  const [
    total, active, suspended, onHold, exempt, new30d,
    statusRows, monthlyRows, feeRows, dailyRows, networkRows, topRows, withSalesRows,
  ] = await Promise.all([
    prisma.merchant.count({ where: { role: "merchant", ...notDeleted } }),
    prisma.merchant.count({ where: { role: "merchant", isActive: true, ...notDeleted } }),
    prisma.merchant.count({ where: { role: "merchant", isActive: false, ...notDeleted } }),
    prisma.merchant.count({ where: { billingHoldAt: { not: null } } }),
    prisma.merchant.count({ where: { role: "merchant", feeExempt: true, ...notDeleted } }),
    prisma.merchant.count({ where: { role: "merchant", createdAt: { gte: since }, ...notDeleted } }),
    prisma.$queryRaw<{ status: string; count: bigint; usd: number | null; unpriced: bigint }[]>`
      SELECT p."status", COUNT(*) AS count,
             SUM(${KNOWN_USD_SQL}) AS usd,
             COUNT(*) FILTER (WHERE ${KNOWN_USD_SQL} IS NULL) AS unpriced
        FROM "Payment" p
       WHERE ${LIVE_SALES} AND p."createdAt" >= ${since}
       GROUP BY p."status"`,
    prisma.$queryRaw<{ month: Date; sessions: bigint; paid: bigint; usd: number | null }[]>`
      SELECT date_trunc('month', p."createdAt") AS month,
             COUNT(*) AS sessions,
             COUNT(*) FILTER (WHERE ${PAID}) AS paid,
             SUM(${KNOWN_USD_SQL}) FILTER (WHERE ${PAID}) AS usd
        FROM "Payment" p
       WHERE ${LIVE_SALES} AND p."createdAt" >= ${monthsFrom}
       GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ month: Date; collected: number | null }[]>`
      SELECT date_trunc('month', s."paidAt") AS month, SUM(s."amountDueUsd") AS collected
        FROM "FeeStatement" s
       WHERE s."status" = 'paid' AND s."paidAt" >= ${monthsFrom}
       GROUP BY 1`,
    prisma.$queryRaw<{ day: Date; paid: bigint; usd: number | null }[]>`
      SELECT date_trunc('day', p."createdAt") AS day,
             COUNT(*) AS paid,
             SUM(${KNOWN_USD_SQL}) AS usd
        FROM "Payment" p
       WHERE ${LIVE_SALES} AND ${PAID} AND p."createdAt" >= ${since}
       GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ chain: string | null; token: string | null; paid: bigint; usd: number | null; amount: number | null }[]>`
      SELECT lower(p."chain") AS chain, lower(p."token") AS token,
             COUNT(*) AS paid,
             SUM(${KNOWN_USD_SQL}) AS usd,
             SUM(COALESCE(p."receivedAmount", p."expectedAmount")) AS amount
        FROM "Payment" p
       WHERE ${LIVE_SALES} AND ${PAID} AND p."createdAt" >= ${since}
       GROUP BY 1, 2 ORDER BY paid DESC
       LIMIT 50`,
    prisma.$queryRaw<{ id: string; name: string; email: string; paid: bigint; usd: number | null }[]>`
      SELECT m."id", m."name", m."email", COUNT(*) AS paid, SUM(${KNOWN_USD_SQL}) AS usd
        FROM "Payment" p
        JOIN "Merchant" m ON m."id" = p."merchantId"
       WHERE ${LIVE_SALES} AND ${PAID} AND p."createdAt" >= ${since} AND m."role" = 'merchant'
       GROUP BY m."id", m."name", m."email"
       ORDER BY COALESCE(SUM(${KNOWN_USD_SQL}), 0) DESC, COUNT(*) DESC
       LIMIT ${TOP_MERCHANTS}`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT p."merchantId") AS count
        FROM "Payment" p
       WHERE ${LIVE_SALES} AND ${PAID} AND p."createdAt" >= ${since}`,
  ]);

  const statusCounts = statusRows.map((r) => ({ status: r.status, count: Number(r.count) }));
  const paidRows = statusRows.filter((r) => (PAID_STATUSES as readonly string[]).includes(r.status));
  const paid = paidRows.reduce((s, r) => s + Number(r.count), 0);
  const paidUsd = paidRows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const pricedPaid = paid - paidRows.reduce((s, r) => s + Number(r.unpriced), 0);
  const outcomes = statusRows
    .filter((r) => [...PAID_STATUSES, "expired", "underpaid", "expired_received"].includes(r.status))
    .reduce((s, r) => s + Number(r.count), 0);

  // Every month in the window, including empty ones, oldest first.
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  const monthly = Array.from({ length: ANALYTICS_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(monthsFrom.getUTCFullYear(), monthsFrom.getUTCMonth() + i, 1));
    const key = monthKey(d);
    const row = monthlyRows.find((r) => monthKey(r.month) === key);
    const fee = feeRows.find((r) => monthKey(r.month) === key);
    return {
      month: key,
      sessions: Number(row?.sessions ?? 0),
      paid: Number(row?.paid ?? 0),
      paidUsd: row?.usd ?? 0,
      feesCollected: fee?.collected ?? 0,
    };
  });
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const daily = Array.from({ length: ANALYTICS_DAYS }, (_, i) => {
    const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate() + i + 1));
    const row = dailyRows.find((r) => dayKey(r.day) === dayKey(d));
    return { day: dayKey(d), paid: Number(row?.paid ?? 0), paidUsd: row?.usd ?? 0 };
  });

  return {
    generatedAt: now.toISOString(),
    merchants: {
      total,
      active,
      suspended,
      onHold,
      exempt,
      new30d,
      withSales30d: Number(withSalesRows[0]?.count ?? 0),
    },
    window: {
      sessions: statusCounts.reduce((s, r) => s + r.count, 0),
      paid,
      paidUsd,
      unpriced: paid - pricedPaid,
      conversion: outcomes ? paid / outcomes : null,
      averageUsd: pricedPaid ? paidUsd / pricedPaid : null,
      statusCounts,
    },
    monthly,
    daily,
    byNetwork: networkRows.map((r) => ({
      chain: r.chain ?? "–",
      token: r.token ?? "–",
      paid: Number(r.paid),
      paidUsd: r.usd ?? 0,
      amount: r.amount ?? 0,
    })),
    topMerchants: topRows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      paid: Number(r.paid),
      paidUsd: r.usd ?? 0,
    })),
  };
}
