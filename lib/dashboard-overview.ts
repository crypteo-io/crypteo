import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { PAID_STATUSES } from "./payment/status";
import { KNOWN_USD_SQL, knownUsdValue } from "./payment/usd-value";
import { DAY_MS } from "./time";

/**
 * Whose payments an overview counts: one merchant's own (test sessions
 * included, as they see them everywhere), or the platform's, which the admin
 * overview shows: every merchant's live sessions, without fee checkouts
 * (those are on Revenue). The admin overview used to read the admin
 * account's own payments, so its charts were always empty.
 */
export type OverviewScope = { merchantId: string } | "platform";

const ACTIVITY_DAYS = 7;
const RECENT_SHOWN = 8;

function scopeWhere(scope: OverviewScope): Prisma.PaymentWhereInput {
  return scope === "platform" ? { isTest: false, feeForStatementId: null } : { merchantId: scope.merchantId };
}

function scopeSql(scope: OverviewScope): Prisma.Sql {
  return scope === "platform"
    ? Prisma.sql`p."isTest" = false AND p."feeForStatementId" IS NULL`
    : Prisma.sql`p."merchantId" = ${scope.merchantId}`;
}

const startOfUtcDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export async function loadOverview(scope: OverviewScope, now: Date) {
  const where = scopeWhere(scope);
  const yesterday = new Date(now.getTime() - DAY_MS);
  const firstDay = new Date(startOfUtcDay(now).getTime() - (ACTIVITY_DAYS - 1) * DAY_MS);
  const paid = Prisma.join([...PAID_STATUSES]);

  const [total24h, byStatus, [volume], daily, recent] = await Promise.all([
    prisma.payment.count({ where: { ...where, createdAt: { gte: yesterday } } }),
    prisma.payment.groupBy({ by: ["status"], where, _count: { _all: true } }),
    // Each session at its known USD value (lib/payment/usd-value.ts):
    // amounts are in each session's own token, so summing them is
    // meaningless, and crypto-priced sessions are counted as excluded.
    prisma.$queryRaw<{ usd: number | null; excluded: bigint }[]>`
      SELECT SUM(${KNOWN_USD_SQL}) AS usd,
             COUNT(*) FILTER (WHERE ${KNOWN_USD_SQL} IS NULL) AS excluded
        FROM "Payment" p
       WHERE ${scopeSql(scope)} AND p."status" IN (${paid}) AND p."createdAt" >= ${yesterday}`,
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT date_trunc('day', p."createdAt") AS day, COUNT(*) AS count
        FROM "Payment" p
       WHERE ${scopeSql(scope)} AND p."status" IN (${paid}) AND p."createdAt" >= ${firstDay}
       GROUP BY 1`,
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: RECENT_SHOWN,
      select: {
        id: true,
        chain: true,
        token: true,
        expectedAmount: true,
        status: true,
        createdAt: true,
        metadata: true,
        merchant: { select: { id: true, name: true } },
      },
    }),
  ]);

  const statusCount = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;
  const perDay = new Map(daily.map((d) => [startOfUtcDay(d.day).getTime(), Number(d.count)]));
  const days = Array.from({ length: ACTIVITY_DAYS }, (_, i) => new Date(firstDay.getTime() + i * DAY_MS));

  return {
    stats: {
      total24h,
      volume24h: volume?.usd ?? 0,
      volumeExcluded: Number(volume?.excluded ?? 0),
      pending: statusCount("pending"),
      confirmed: statusCount("confirmed"),
    },
    statusBreakdown: {
      confirmed: statusCount("confirmed"),
      pending: statusCount("pending"),
      confirming: statusCount("confirming"),
      underpaid: statusCount("underpaid"),
      overpaid: statusCount("overpaid"),
      expired: statusCount("expired"),
      // Late payments (funds arrived after expiry) need attention; leaving
      // them out made the status total disagree with the payments list.
      expired_received: statusCount("expired_received"),
    },
    dailyVolumes: days.map((d) => perDay.get(d.getTime()) ?? 0),
    dailyLabels: days.map((d) => d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })),
    recentPayments: recent.map(({ metadata, ...p }) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      usdValue: knownUsdValue({ ...p, metadata }),
    })),
  };
}

export type Overview = Awaited<ReturnType<typeof loadOverview>>;
