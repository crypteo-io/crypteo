import { prisma } from "../db";

// How far back the merchant dashboard looks at webhook deliveries, and how many
// of the merchant's sessions and log rows it reads (keeps the queries bounded).
export const WEBHOOK_HEALTH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEBHOOK_HEALTH_MAX_PAYMENTS = 500;
const WEBHOOK_HEALTH_MAX_LOGS = 5000;

export interface DeliveryRow {
  url: string;
  success: boolean;
  statusCode: number | null;
  createdAt: Date;
}

export interface EndpointHealth {
  url: string;
  attempts: number;
  failures: number;
  /** The latest delivery to this URL failed. */
  failing: boolean;
  lastStatusCode: number | null;
  lastAt: string;
  /**
   * Still a delivery target: an active endpoint, an active link's URL, or a
   * recent payment's own URL. A URL the merchant replaced keeps its last
   * failure in the log for 7 days; only current ones warrant a warning.
   */
  current: boolean;
}

/**
 * Per-URL delivery outcomes, newest first. An endpoint is failing when its
 * latest delivery failed. One merchant's URL was their single-page app, which
 * answered 405 to every delivery for a month (2026-09-16 → 10-15), and nothing
 * told them; their orders stayed "pending" while payments were confirmed.
 * With several endpoints (one per site) each is judged on its own.
 */
export function summarizeDeliveries(
  rows: readonly DeliveryRow[],
  currentUrls: ReadonlySet<string> = new Set(),
): EndpointHealth[] {
  const byUrl = new Map<string, EndpointHealth>();
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const row of sorted) {
    const h = byUrl.get(row.url);
    if (!h) {
      byUrl.set(row.url, {
        url: row.url,
        attempts: 1,
        failures: row.success ? 0 : 1,
        failing: !row.success,
        lastStatusCode: row.statusCode,
        lastAt: row.createdAt.toISOString(),
        current: currentUrls.has(row.url),
      });
    } else {
      h.attempts++;
      if (!row.success) h.failures++;
    }
  }
  return [...byUrl.values()];
}

/** Delivery health of each URL the merchant's recent live sessions were sent to. */
export async function webhookHealth(
  merchantId: string,
  now: Date = new Date(),
): Promise<EndpointHealth[]> {
  const since = new Date(now.getTime() - WEBHOOK_HEALTH_WINDOW_MS);
  const payments = await prisma.payment.findMany({
    where: { merchantId, isTest: false, createdAt: { gte: since } },
    select: { id: true, webhookUrl: true },
    orderBy: { createdAt: "desc" },
    take: WEBHOOK_HEALTH_MAX_PAYMENTS,
  });
  if (payments.length === 0) return [];

  const [endpoints, links] = await Promise.all([
    prisma.webhookEndpoint.findMany({
      where: { merchantId, isActive: true },
      select: { url: true },
    }),
    prisma.paymentLink.findMany({
      where: { merchantId, isActive: true, webhookUrl: { not: null } },
      select: { webhookUrl: true },
      take: WEBHOOK_HEALTH_MAX_PAYMENTS,
    }),
  ]);
  const currentUrls = new Set<string>([
    ...endpoints.map((e) => e.url),
    ...links.flatMap((l) => (l.webhookUrl ? [l.webhookUrl] : [])),
    ...payments.flatMap((p) => (p.webhookUrl ? [p.webhookUrl] : [])),
  ]);

  const rows = await prisma.webhookLog.findMany({
    where: {
      paymentId: { in: payments.map((p) => p.id) },
      createdAt: { gte: since },
    },
    select: { url: true, success: true, statusCode: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: WEBHOOK_HEALTH_MAX_LOGS,
  });
  return summarizeDeliveries(rows ?? [], currentUrls);
}
