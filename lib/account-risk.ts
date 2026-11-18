import { adminUrl, siteOrigin } from "./admin-host";
import { sendAdminAlert } from "./admin-alerts";
import { prisma } from "./db";
import { accountRiskAdminHtml } from "./emails/templates";
import { notifyAccountSuspended } from "./mailer";
import { notifyAdmins } from "./notifications";
import { APPEAL_SUBJECT, merchantSuspensionLine, SUSPENSION_AUTOMATIC } from "./suspension-reasons";
import { DAY_MS } from "./time";

// A merchant account caught probing the platform is suspended on the spot and
// signed out everywhere. On 2026-11-15 a prober signed up, fuzzed every route
// it could reach with SQL injection, asked for other merchants' records and
// set webhook tests at httpbin; admins only learned of it from the contact
// form. A scored threshold (until 2026-11-16) let accounts sit just under it,
// so any one probe now suspends (user, 2026-11-16). Each probe is kept as an
// AccountRiskEvent for the admin who reviews the appeal.

export const RISK_KINDS = [
  /** Injection-shaped text in a name, title or description (flagProbeInput). */
  "probe_input",
  /** A signed-in or API-key request carrying an injection payload in its URL. */
  "probe_request",
  /** Another merchant's existing record asked for by id. */
  "foreign_record",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

/**
 * Distinct other merchants' records asked for in a day before an account is
 * suspended. One is a stale tab from another account the same person owns;
 * the 2026-11-15 prober walked dozens.
 */
export const FOREIGN_RECORDS_TO_SUSPEND = 3;

/** Recent events listed in the admin alert. */
const EVENTS_LISTED = 20;
const MAX_DETAIL_CHARS = 300;

/** What sign-in tells a suspended account. As vague as the email, on purpose. */
export const SUSPENDED_SIGN_IN_MESSAGE =
  "Your account is suspended for now. Check your inbox for our email, or send an appeal if you think we got it wrong.";

/** Where a suspended merchant asks for a review. */
export function appealUrl(): string {
  return `${siteOrigin()}/contact?subject=${encodeURIComponent(APPEAL_SUBJECT)}`;
}

export interface RiskEventRow {
  kind: string;
  detail: string;
  createdAt: Date;
}

/**
 * A merchant account is suspended; an admin account (not a merchant, and one
 * of the people who would reactivate it) is only flagged for another admin.
 */
export function riskDecision(opts: { role: string; kind: RiskKind; foreignRecords: number }): "none" | "flag" | "suspend" {
  if (opts.kind === "foreign_record" && opts.foreignRecords < FOREIGN_RECORDS_TO_SUSPEND) return "none";
  return opts.role === "merchant" ? "suspend" : "flag";
}

/**
 * Record one probe against an account and act on it. Never throws: it runs
 * beside the request that raised it, which must not fail because of it.
 */
export async function recordRiskEvent(merchantId: string, kind: RiskKind, detail: string): Promise<void> {
  try {
    const account = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { name: true, email: true, role: true, isActive: true },
    });
    if (!account?.isActive) return;

    await prisma.accountRiskEvent.create({
      data: { merchantId, kind, detail: detail.slice(0, MAX_DETAIL_CHARS) },
    });
    const events = await prisma.accountRiskEvent.findMany({
      where: { merchantId, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
      select: { kind: true, detail: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: EVENTS_LISTED,
    });
    const foreignRecords = new Set(events.filter((e) => e.kind === "foreign_record").map((e) => e.detail)).size;
    const decision = riskDecision({ role: account.role, kind, foreignRecords });
    if (decision === "suspend") {
      await suspendForRisk(merchantId, account, events);
    } else if (decision === "flag") {
      await flagForReview(merchantId, account, events);
    }
  } catch (error) {
    console.error("[account-risk] event not handled:", error);
  }
}

/**
 * A record that exists but belongs to another account was asked for by id. A
 * real merchant only ever has their own ids; the 2026-11-15 prober walked
 * other merchants' payment, link and endpoint ids.
 */
export async function noteForeignRecord(merchantId: string, what: string, record: { id: string; merchantId: string } | null): Promise<void> {
  if (record && record.merchantId !== merchantId) {
    await recordRiskEvent(merchantId, "foreign_record", `${what} ${record.id}`);
  }
}

async function suspendForRisk(
  merchantId: string,
  account: { name: string; email: string },
  events: RiskEventRow[],
): Promise<void> {
  const now = new Date();
  // Compare-and-set: a second request racing this one suspends nothing twice.
  // sessionsRevokedAt signs every browser out and voids remembered devices
  // (lib/auth.ts, lib/trusted-device.ts); auth() already refuses the account
  // from this request on.
  const won = await prisma.$transaction(async (tx) => {
    const { count } = await tx.merchant.updateMany({
      where: { id: merchantId, isActive: true },
      data: { isActive: false, suspendedAt: now, suspensionReason: SUSPENSION_AUTOMATIC, sessionsRevokedAt: now },
    });
    if (count !== 1) return false;
    await tx.adminAuditLog.create({
      data: {
        adminId: "system",
        adminEmail: "system",
        merchantId,
        action: "autoSuspend",
        details: { kinds: [...new Set(events.map((e) => e.kind))] },
      },
    });
    return true;
  });
  if (!won) return;

  await notifyAccountSuspended({
    to: account.email,
    merchantName: account.name,
    reasonLine: merchantSuspensionLine(SUSPENSION_AUTOMATIC),
    appealUrl: appealUrl(),
  });
  await alertAdmins("suspended", merchantId, account, events);
}

async function flagForReview(
  merchantId: string,
  account: { name: string; email: string },
  events: RiskEventRow[],
): Promise<void> {
  const link = `/merchants/${merchantId}`;
  const recent = await prisma.notification.findFirst({
    where: { kind: "admin_account_risk", link, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    select: { id: true },
  });
  if (recent) return;
  await alertAdmins("flagged", merchantId, account, events);
}

async function alertAdmins(
  outcome: "suspended" | "flagged",
  merchantId: string,
  account: { name: string; email: string },
  events: RiskEventRow[],
): Promise<void> {
  const link = `/merchants/${merchantId}`;
  const title =
    outcome === "suspended" ? `Account suspended automatically: ${account.name}` : `Admin account probing: ${account.name}`;
  await notifyAdmins({
    kind: "admin_account_risk",
    title,
    body: [...new Set(events.map((e) => e.kind))].join(", "),
    link,
  });
  await sendAdminAlert(
    `Crypteo: ${title}`,
    accountRiskAdminHtml({
      outcome,
      merchantName: account.name,
      merchantEmail: account.email,
      events: events.map((e) => ({ kind: e.kind, detail: e.detail, at: e.createdAt.toISOString() })),
      pageUrl: adminUrl(link),
    }),
  );
}
