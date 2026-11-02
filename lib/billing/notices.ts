/**
 * What merchants hear about their platform fees, by email and in the
 * dashboard: the invoice (7 days before it's due), reminders 72h and 24h
 * before, the billing hold at the due date, and its release. Each is sent at
 * most once per statement: the run claims the stamp before sending and
 * releases it when the mail fails, so the next run retries.
 */
import { isDeletedAccountEmail } from "../account-state";
import { prisma } from "../db";
import { billingNoticeHtml } from "../emails/templates";
import { sendEmail } from "../mailer";
import { notifyAdmins, notifyMerchant, type MerchantKind } from "../notifications";
import { HOUR_MS } from "../time";
import { invoicePeriodLabel } from "./cycle";
import { formatUsd } from "./fee-schedule";

const MAX_NOTICES_PER_RUN = 500;
const BASE_URL = process.env.NEXTAUTH_URL || "https://crypteo.io";
export const BILLING_PATH = "/dashboard/billing";

export type NoticeKind = "issued" | "72h" | "24h" | "hold";

const NOTICE_FIELD = {
  issued: "noticeIssuedAt",
  "72h": "notice72hAt",
  "24h": "notice24hAt",
  hold: "noticeHoldAt",
} as const satisfies Record<NoticeKind, string>;

export interface NoticeState {
  dueAt: Date | null;
  noticeIssuedAt: Date | null;
  notice72hAt: Date | null;
  notice24hAt: Date | null;
  noticeHoldAt: Date | null;
}

/**
 * The one notice an open statement is owed now, or null. Only the latest
 * window counts: a run that missed the 72h window (worker down) sends the
 * 24h notice, never both, and never an earlier one after a later one.
 */
export function dueNotice(s: NoticeState, now: Date): NoticeKind | null {
  if (!s.dueAt) return null;
  const left = s.dueAt.getTime() - now.getTime();
  if (left <= 0) return s.noticeHoldAt ? null : "hold";
  if (s.noticeHoldAt) return null;
  if (left <= 24 * HOUR_MS) return s.notice24hAt ? null : "24h";
  if (s.notice24hAt) return null;
  if (left <= 72 * HOUR_MS) return s.notice72hAt ? null : "72h";
  if (s.notice72hAt) return null;
  return s.noticeIssuedAt ? null : "issued";
}

const dateTime = (d: Date) =>
  `${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;

export interface StatementForNotice {
  accruingSince: Date | null;
  periodStart: Date;
  periodEnd: Date;
  amountDueUsd: number;
  dueAt: Date | null;
}

export interface NoticeEmail {
  kind: MerchantKind;
  subject: string;
  title: string;
  lines: string[];
  html: string;
}

const billingUrl = `${BASE_URL}${BILLING_PATH}`;

/** The email and bell entry for one fee notice. */
export function noticeEmail(kind: NoticeKind, s: StatementForNotice, merchantName: string): NoticeEmail {
  const amount = formatUsd(s.amountDueUsd);
  const month = invoicePeriodLabel(s);
  const due = s.dueAt ? dateTime(s.dueAt) : "–";
  const pay = `Pay ${amount} in USDT or USDC from the Billing page.`;
  const blocked = "If it isn't paid by then, your checkouts stop accepting payments until it is.";
  const content =
    kind === "issued"
      ? {
          kind: "fee_invoice" as const,
          subject: `🧾 Your Crypteo fees: ${amount} due`,
          title: `Fee invoice: ${amount} for ${month}`,
          lines: [`Your platform fees for ${month} come to ${amount}, due ${due}.`, pay, blocked],
          tone: "info" as const,
        }
      : kind === "hold"
        ? {
            kind: "fee_hold" as const,
            subject: `⛔ Payments paused: ${amount} in fees overdue`,
            title: `Payments paused: ${amount} overdue`,
            lines: [
              `Your fee invoice for ${month} of ${amount} was due ${due} and hasn't been paid.`,
              "Your checkouts are paused: buyers can't start a payment until it is paid. Payments already in progress are still watched and credited.",
              `${pay} Checkouts resume within minutes of the payment confirming.`,
            ],
            tone: "danger" as const,
          }
        : {
            kind: "fee_reminder" as const,
            subject: `⏳ ${amount} in fees due in ${kind === "72h" ? "3 days" : "24 hours"}`,
            title: `Fees due in ${kind === "72h" ? "3 days" : "24 hours"}: ${amount}`,
            lines: [`Your fee invoice for ${month} of ${amount} is due ${due}.`, pay, blocked],
            tone: "warning" as const,
          };
  return {
    ...content,
    html: billingNoticeHtml({
      merchantName,
      title: content.title,
      lines: content.lines,
      tone: content.tone,
      rows: [
        { label: "Amount due", value: amount },
        { label: "Billing period", value: month },
        { label: "Due", value: due },
      ],
      billingUrl,
      cta: "Pay now",
    }),
  };
}

/** The email and bell entry when checkouts reopen after a hold. */
export function holdLiftedEmail(merchantName: string): NoticeEmail {
  const title = "Payments restored";
  const lines = ["Your overdue platform fees are settled and your checkouts accept payments again."];
  return {
    kind: "fee_restored",
    subject: `✅ ${title} on Crypteo`,
    title,
    lines,
    html: billingNoticeHtml({
      merchantName,
      title,
      lines,
      tone: "success",
      rows: [{ label: "Status", value: "Accepting payments" }],
      billingUrl,
      cta: "Open billing",
    }),
  };
}

async function merchantContact(merchantId: string) {
  const m = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, email: true },
  });
  return m && !isDeletedAccountEmail(m.email) ? m : null;
}

/** Send every notice open statements are owed; returns how many went out. */
export async function sendDueNotices(now: Date = new Date()): Promise<number> {
  const open = await prisma.feeStatement.findMany({
    where: { status: "open" },
    select: {
      id: true,
      merchantId: true,
      accruingSince: true,
      periodStart: true,
      periodEnd: true,
      amountDueUsd: true,
      dueAt: true,
      noticeIssuedAt: true,
      notice72hAt: true,
      notice24hAt: true,
      noticeHoldAt: true,
    },
    orderBy: { dueAt: "asc" },
    take: MAX_NOTICES_PER_RUN,
  });
  let sent = 0;
  for (const s of open) {
    const kind = dueNotice(s, now);
    if (!kind) continue;
    const field = NOTICE_FIELD[kind];
    const { count } = await prisma.feeStatement.updateMany({
      where: { id: s.id, status: "open", [field]: null },
      data: { [field]: now },
    });
    if (!count) continue;

    const merchant = await merchantContact(s.merchantId);
    if (!merchant) continue;
    const c = noticeEmail(kind, s, merchant.name);
    const ok = (await sendEmail({ to: merchant.email, subject: c.subject, html: c.html })).success;
    if (!ok) {
      await prisma.feeStatement.updateMany({
        where: { id: s.id, [field]: now },
        data: { [field]: null },
      });
      console.error(`[billing] ${kind} notice for statement ${s.id} not delivered; will retry`);
      continue;
    }
    sent++;
    await notifyMerchant(s.merchantId, {
      kind: c.kind,
      title: c.title,
      body: c.lines.join(" "),
      link: BILLING_PATH,
    });
    if (kind === "hold") {
      await notifyAdmins({
        kind: "admin_billing_hold",
        title: `Billing hold: ${merchant.name}`,
        body: `${formatUsd(s.amountDueUsd)} for ${invoicePeriodLabel(s)} is overdue; their checkouts are paused.`,
        link: `/merchants/${s.merchantId}`,
      });
    }
  }
  return sent;
}

/** A fee statement was paid (by checkout or by an admin's hand). */
export async function notifyStatementPaid(statementId: string, how: "checkout" | "admin"): Promise<void> {
  const s = await prisma.feeStatement.findUnique({
    where: { id: statementId },
    select: { merchantId: true, accruingSince: true, periodStart: true, periodEnd: true, amountDueUsd: true },
  });
  if (!s) return;
  const merchant = await merchantContact(s.merchantId);
  const amount = formatUsd(s.amountDueUsd);
  const month = invoicePeriodLabel(s);
  await notifyMerchant(s.merchantId, {
    kind: "fee_paid",
    title: `Fee invoice paid: ${amount}`,
    body: `Your platform fees for ${month} are settled. Thank you.`,
    link: BILLING_PATH,
  });
  if (how === "checkout" && merchant) {
    await notifyAdmins({
      kind: "admin_fee_received",
      title: `Fees received: ${amount} from ${merchant.name}`,
      body: `Invoice for ${month} paid by checkout.`,
      link: "/revenue",
    });
  }
}

/** Checkouts are open again after a billing hold. */
export async function notifyHoldLifted(merchantId: string): Promise<void> {
  const merchant = await merchantContact(merchantId);
  if (!merchant) return;
  const c = holdLiftedEmail(merchant.name);
  await notifyMerchant(merchantId, { kind: c.kind, title: c.title, body: c.lines.join(" "), link: BILLING_PATH });
  const ok = (await sendEmail({ to: merchant.email, subject: c.subject, html: c.html })).success;
  if (!ok) console.error(`[billing] hold-lifted notice for ${merchantId} not delivered`);
}
