import { Prisma } from "@prisma/client";
import { accountDashboardUrl } from "../admin-host";
import { prisma } from "../db";
import { webhookFailingHtml } from "../emails/templates";
import { sendEmail } from "../mailer";
import { webhookHealth, type EndpointHealth } from "./webhook-health";

// The dashboard's failing-webhook notice only reaches a merchant who signs in;
// the merchant whose SPA answered 405 for a month (see webhook-health.ts) never
// looked. The worker emails it as well: once when a URL starts failing, again
// at most weekly while it keeps failing, and at once if it fails again after
// recovering.

export const WEBHOOK_ALERT_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
/** Merchants whose deliveries failed this recently are checked. */
const RECENT_FAILURE_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGS = 5000;

export interface NoticeRow {
  id: string;
  url: string;
  sentAt: Date;
}

export interface AlertPlan {
  /** Failing URLs due an email, with the notice row it would replace. */
  send: { health: EndpointHealth; notice: NoticeRow | null }[];
  /** Notices whose URL no longer fails (or is no longer used): cleared. */
  clear: NoticeRow[];
}

export function planWebhookAlerts(
  health: readonly EndpointHealth[],
  notices: readonly NoticeRow[],
  now: Date,
): AlertPlan {
  const failing = health.filter((h) => h.failing && h.current);
  const failingUrls = new Set(failing.map((h) => h.url));
  const byUrl = new Map(notices.map((n) => [n.url, n]));
  return {
    send: failing.flatMap((h) => {
      const notice = byUrl.get(h.url) ?? null;
      if (notice && now.getTime() - notice.sentAt.getTime() < WEBHOOK_ALERT_REPEAT_MS) return [];
      return [{ health: h, notice }];
    }),
    clear: notices.filter((n) => !failingUrls.has(n.url)),
  };
}

/** Claim one URL's notice compare-and-set, so a second worker can't email it too. */
async function claim(merchantId: string, url: string, notice: NoticeRow | null, now: Date): Promise<boolean> {
  if (notice) {
    const r = await prisma.webhookFailureNotice.updateMany({
      where: { id: notice.id, sentAt: notice.sentAt },
      data: { sentAt: now },
    });
    return r.count === 1;
  }
  try {
    await prisma.webhookFailureNotice.create({ data: { merchantId, url, sentAt: now } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** Give a claim back after the mail failed, so the next run tries again. */
async function release(merchantId: string, url: string, notice: NoticeRow | null, now: Date): Promise<void> {
  if (notice) {
    await prisma.webhookFailureNotice.updateMany({
      where: { merchantId, url, sentAt: now },
      data: { sentAt: notice.sentAt },
    });
  } else {
    await prisma.webhookFailureNotice.deleteMany({ where: { merchantId, url, sentAt: now } });
  }
}

export async function alertMerchantWebhooks(merchantId: string, now: Date): Promise<boolean> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, email: true, role: true, isActive: true },
  });
  if (!merchant?.isActive) return false;

  const [health, notices] = await Promise.all([
    webhookHealth(merchantId, now),
    prisma.webhookFailureNotice.findMany({
      where: { merchantId },
      select: { id: true, url: true, sentAt: true },
    }),
  ]);
  const plan = planWebhookAlerts(health, notices, now);

  if (plan.clear.length) {
    await prisma.webhookFailureNotice.deleteMany({
      where: { id: { in: plan.clear.map((n) => n.id) } },
    });
  }

  const claimed: AlertPlan["send"] = [];
  for (const item of plan.send) {
    if (await claim(merchantId, item.health.url, item.notice, now)) claimed.push(item);
  }
  if (!claimed.length) return false;

  const result = await sendEmail({
    to: merchant.email,
    subject:
      claimed.length === 1
        ? "Your webhook isn't getting through"
        : `${claimed.length} webhooks aren't getting through`,
    html: webhookFailingHtml({
      merchantName: merchant.name,
      endpoints: claimed.map((c) => c.health),
      settingsUrl: accountDashboardUrl(merchant.role, "/dashboard/settings?tab=webhooks"),
    }),
  });
  if (!result.success) {
    for (const item of claimed) await release(merchantId, item.health.url, item.notice, now);
    return false;
  }
  return true;
}

/**
 * Worker pass: every merchant with a failed live delivery in the last hour,
 * plus every merchant with an open notice (to clear recovered URLs). Resolves
 * to the number of merchants emailed.
 */
export async function alertFailingWebhooks(now: Date = new Date()): Promise<number> {
  const failed = await prisma.webhookLog.findMany({
    where: { success: false, createdAt: { gte: new Date(now.getTime() - RECENT_FAILURE_MS) } },
    select: { paymentId: true },
    distinct: ["paymentId"],
    take: MAX_FAILED_LOGS,
  });
  const [payments, open] = await Promise.all([
    prisma.payment.findMany({
      where: { id: { in: failed.map((f) => f.paymentId) }, isTest: false },
      select: { merchantId: true },
      distinct: ["merchantId"],
    }),
    prisma.webhookFailureNotice.findMany({ select: { merchantId: true }, distinct: ["merchantId"] }),
  ]);
  const merchantIds = new Set([...payments, ...open].map((r) => r.merchantId));

  let emailed = 0;
  for (const id of merchantIds) {
    try {
      if (await alertMerchantWebhooks(id, now)) emailed++;
    } catch (err) {
      console.error(`[webhook-alerts] merchant ${id}:`, err);
    }
  }
  return emailed;
}
