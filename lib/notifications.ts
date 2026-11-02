/**
 * In-app notifications (the dashboard bell). The only writer of Notification
 * rows (guarded by lib/notifications.test.ts).
 *
 * Audiences never mix. A merchant is told about their own payments, their
 * platform fees and messages an admin addressed to them; nothing else. Every
 * operational kind (failures, orphans, holds placed, billing errors) is an
 * ADMIN_KINDS value and only ever reaches admin accounts: notifyMerchant
 * refuses it, and its text is never built from an error message.
 *
 * Writes never throw: a notification must not fail the payment, the billing
 * run or the admin action that raised it.
 */
import { prisma } from "./db";
import { BODY_MAX, TITLE_MAX } from "./notification-limits";
import { DAY_MS } from "./time";

export { BODY_MAX, TITLE_MAX };

export const MERCHANT_KINDS = [
  "payment_paid",
  "payment_underpaid",
  "payment_late",
  "fee_invoice",
  "fee_reminder",
  "fee_hold",
  "fee_restored",
  "fee_paid",
  "admin_message",
] as const;
export type MerchantKind = (typeof MERCHANT_KINDS)[number];

export const ADMIN_KINDS = [
  "admin_fee_received",
  "admin_billing_hold",
  "admin_billing_error",
  "admin_orphan",
  "admin_contact",
  "admin_fee_exemption",
  "admin_proxy_failing",
  "admin_proxy_recovered",
  "admin_probe",
  "admin_access",
] as const;
export type AdminKind = (typeof ADMIN_KINDS)[number];

/** The bell lists this many; older ones stay readable in the list endpoint. */
export const NOTIFICATIONS_PAGE = 30;
/** Read notifications older than this are purged by the worker. */
const NOTIFICATION_RETENTION_DAYS = 90;

export interface NotificationInput<K extends string> {
  kind: K;
  title: string;
  body: string;
  /** A path in the recipient's dashboard; anything else is dropped. */
  link?: string | null;
}

// Where each audience's links may point: a merchant's /dashboard, or the
// admin host's pages (served there at bare paths, proxy.ts).
const LINK_ROOTS: Record<"merchant" | "admin", RegExp> = {
  merchant: /^\/dashboard(?=$|[/?])/,
  admin: /^\/(?:merchants|orphans|revenue|contact|analytics|proxies)(?=$|[/?])/,
};

/** Only a path in the recipient's dashboard: a notification never links off it. */
export function safeDashboardLink(
  link: string | null | undefined,
  audience: "merchant" | "admin",
): string | null {
  if (!link) return null;
  return LINK_ROOTS[audience].test(link) &&
    /^\/[A-Za-z0-9_\-/?=&.]*$/.test(link) &&
    !link.includes("//") &&
    !link.includes("..")
    ? link
    : null;
}

function rowData<K extends string>(
  merchantId: string,
  n: NotificationInput<K>,
  audience: "merchant" | "admin",
) {
  return {
    merchantId,
    kind: n.kind,
    title: n.title.slice(0, TITLE_MAX),
    body: n.body.slice(0, BODY_MAX),
    link: safeDashboardLink(n.link, audience),
  };
}

function isMerchantKind(kind: string): kind is MerchantKind {
  return (MERCHANT_KINDS as readonly string[]).includes(kind);
}

/** Notify one account about its own business. Never an operational kind. */
export async function notifyMerchant(
  merchantId: string,
  n: NotificationInput<MerchantKind>,
): Promise<boolean> {
  if (!isMerchantKind(n.kind)) {
    console.error(`[notifications] refused kind "${n.kind}" for a merchant`);
    return false;
  }
  try {
    await prisma.notification.create({ data: rowData(merchantId, n, "merchant") });
    return true;
  } catch (error) {
    console.error("[notifications] merchant notification not written:", error);
    return false;
  }
}

/** The same notification to many accounts (an admin's broadcast). */
export async function notifyMerchants(
  merchantIds: string[],
  n: NotificationInput<MerchantKind>,
): Promise<number> {
  if (!isMerchantKind(n.kind) || merchantIds.length === 0) return 0;
  try {
    const { count } = await prisma.notification.createMany({
      data: merchantIds.map((id) => rowData(id, n, "merchant")),
    });
    return count;
  } catch (error) {
    console.error("[notifications] broadcast not written:", error);
    return 0;
  }
}

/** Notify every active admin account. */
export async function notifyAdmins(n: NotificationInput<AdminKind>): Promise<number> {
  if (!(ADMIN_KINDS as readonly string[]).includes(n.kind)) return 0;
  try {
    const admins = await prisma.merchant.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });
    if (admins.length === 0) return 0;
    const { count } = await prisma.notification.createMany({
      data: admins.map((a) => rowData(a.id, n, "admin")),
    });
    return count;
  } catch (error) {
    console.error("[notifications] admin notification not written:", error);
    return 0;
  }
}

/** Purge read notifications past retention; unread ones are kept. */
export async function purgeOldNotifications(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const { count } = await prisma.notification.deleteMany({
    where: { readAt: { not: null }, createdAt: { lt: cutoff } },
  });
  return count;
}
