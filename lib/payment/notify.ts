import type { Payment } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "../db";
import { formatAmount } from "../format";
import { sendEmail } from "../mailer";
import { isSafeWebhookUrl, postWebhook } from "../security";
import { notifyMerchant } from "../notifications";
import { notifyTelegramPaid } from "../telegram/bot";
import { isPaidStatus } from "./status";
import {
  paymentSuccessHtml,
  paymentUnderpaidHtml,
  paymentExpiredHtml,
} from "../emails/templates";

const DASHBOARD_BASE = process.env.NEXTAUTH_URL || "https://crypteo.io";

function dashboardUrl(paymentId: string) {
  return `${DASHBOARD_BASE}/dashboard/payments/${paymentId}`;
}

export async function triggerNotifications(payment: Payment) {
  console.log(
    `Triggering notifications for payment ${payment.id} status ${payment.status}...`,
  );

  const merchant = await prisma.merchant.findUnique({
    where: { id: payment.merchantId },
  });
  if (!merchant) return;
  // A suspended or deleted account uses nothing: no webhooks, no emails. Its
  // open checkouts are still watched and recorded (buyers may have paid), and
  // the merchant can resend from the payment page once reactivated.
  if (!merchant.isActive) {
    console.log(
      `Notifications skipped for payment ${payment.id}: merchant ${merchant.id} is not active`,
    );
    return;
  }

  // ── 1. Webhook (delivered with backoff retry on failure) ───────────────────
  // A status change is a new event with its own retry budget. webhookAttempts
  // is otherwise cumulative, so a payment whose `confirming` webhook burned
  // through the schedule would get zero retries for its `confirmed` one.
  await deliverWebhook(payment, { newEvent: true });

  // ── 2. In-app notification (only outcomes the merchant acts on) ───────────
  await notifyPaymentOutcome(payment);

  // ── 3. Merchant emails ─────────────────────────────────────────────────────
  const { status } = payment;

  // Only send emails when a payment action occurred — not on pending/no-funds states
  const shouldEmail =
    status === "confirmed" ||
    status === "overpaid" ||
    status === "underpaid" ||
    status === "expired_received" ||
    status === "expired";

  if (!shouldEmail) return;

  // Don't email on plain "expired" if no funds were ever received
  if (status === "expired" && !payment.receivedAmount) return;

  const chain = payment.chain ?? "unknown";
  const token = payment.token ?? "";
  const walletAddress = payment.walletAddress ?? "";
  const createdAt = payment.createdAt.toISOString();
  const now = new Date().toISOString();

  let subject = "";
  let html = "";

  if (status === "confirmed" || status === "overpaid") {
    subject = `✅ Payment Received: ${formatAmount(payment.receivedAmount ?? payment.expectedAmount, token)} ${token}`;
    html = paymentSuccessHtml({
      merchantName: merchant.name,
      paymentId: payment.id,
      externalId: payment.externalId,
      chain,
      token,
      expectedAmount: payment.expectedAmount,
      receivedAmount: payment.receivedAmount ?? payment.expectedAmount,
      txHash: payment.txHash,
      walletAddress,
      customerEmail: payment.customerEmail,
      createdAt,
      confirmedAt: now,
      dashboardUrl: dashboardUrl(payment.id),
    });
  } else if (status === "underpaid") {
    const received = payment.receivedAmount ?? 0;
    const shortfall = payment.expectedAmount - received;
    subject = `⚠️ Underpaid: ${formatAmount(received, token)} ${token} received (expected ${formatAmount(payment.expectedAmount, token)} ${token})`;
    html = paymentUnderpaidHtml({
      merchantName: merchant.name,
      paymentId: payment.id,
      externalId: payment.externalId,
      chain,
      token,
      expectedAmount: payment.expectedAmount,
      receivedAmount: received,
      shortfall,
      txHash: payment.txHash,
      walletAddress,
      customerEmail: payment.customerEmail,
      createdAt,
      dashboardUrl: dashboardUrl(payment.id),
    });
  } else if (status === "expired_received" || status === "expired") {
    const hadFunds = status === "expired_received" || !!payment.receivedAmount;
    subject = hadFunds
      ? `🕐 Late Payment Detected, Not Credited (${payment.id})`
      : `⏱️ Payment Expired: No Funds Received (${payment.id})`;
    html = paymentExpiredHtml({
      merchantName: merchant.name,
      paymentId: payment.id,
      externalId: payment.externalId,
      chain,
      token,
      expectedAmount: payment.expectedAmount,
      receivedAmount: payment.receivedAmount,
      txHash: payment.txHash,
      walletAddress,
      customerEmail: payment.customerEmail,
      createdAt,
      expiredAt: payment.expiresAt.toISOString(),
      hadFunds,
      dashboardUrl: dashboardUrl(payment.id),
    });
  }

  if (!subject || !html) return;

  const result = await sendEmail({ to: merchant.email, subject, html });

  await prisma.emailLog.create({
    data: {
      paymentId: payment.id,
      type: status,
      recipient: merchant.email,
      subject,
      sentAt: result.success ? new Date() : null,
      error: result.success ? null : "Failed to send",
    },
  });

  if (result.success) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { emailSentAt: new Date() },
    });
  }
}

/**
 * The bell entry for a payment outcome. Built from the payment's own fields
 * only, never from an error: a merchant's notifications carry no platform
 * internals (lib/notifications.ts).
 */
export async function notifyPaymentOutcome(payment: Payment): Promise<void> {
  // A fee checkout pays the platform; billing announces it (fee_paid to the
  // payer, admin_fee_received to admins), not the billing account's bell.
  if (payment.feeForStatementId) return;
  const token = (payment.token ?? "").toUpperCase();
  const received = `${formatAmount(payment.receivedAmount ?? payment.expectedAmount, payment.token)} ${token}`.trim();
  const expected = `${formatAmount(payment.expectedAmount, payment.token)} ${token}`.trim();
  const ref = payment.externalId ? ` (order ${payment.externalId})` : "";
  const link = `/dashboard/payments/${payment.id}`;
  switch (payment.status) {
    case "confirmed":
    case "overpaid":
      await notifyMerchant(payment.merchantId, {
        kind: "payment_paid",
        title: `Payment received: ${received}`,
        body: `A payment${ref} is paid in full${payment.status === "overpaid" ? " (the buyer sent more than requested)" : ""}.`,
        link,
      });
      if (!payment.isTest) await notifyTelegramPaid(payment.merchantId, `Payment received: ${received}${ref}`);
      return;
    case "underpaid":
      await notifyMerchant(payment.merchantId, {
        kind: "payment_underpaid",
        title: `Underpaid: ${received} of ${expected}`,
        body: `A payment${ref} arrived short. The buyer can still top it up before the session ends.`,
        link,
      });
      return;
    case "expired_received":
      await notifyMerchant(payment.merchantId, {
        kind: "payment_late",
        title: `Late payment: ${received}`,
        body: `Funds for a payment${ref} arrived after it expired. Review it before fulfilling the order.`,
        link,
      });
      return;
  }
}

// Backoff before each retry, indexed by (attempt number − 1). Once the schedule
// is exhausted the webhook is abandoned (nextWebhookRetryAt cleared). This gives
// one initial attempt plus WEBHOOK_BACKOFF_MS.length retries.
const WEBHOOK_BACKOFF_MS = [
  60_000, // 1 minute
  5 * 60_000, // 5 minutes
  15 * 60_000, // 15 minutes
  60 * 60_000, // 1 hour
  6 * 60 * 60_000, // 6 hours
];

// A merchant endpoint that hangs would otherwise pin a worker poll cycle (or a
// dashboard request) until the platform's socket timeout.
export const WEBHOOK_TIMEOUT_MS = 10_000;
// WebhookLog.response is merchant-controlled; cap it so a hostile endpoint
// can't stream megabytes into our database on every retry.
export const WEBHOOK_RESPONSE_MAX_CHARS = 2048;

function nextWebhookRetryAt(attempt: number): Date | null {
  const backoff = WEBHOOK_BACKOFF_MS[attempt - 1];
  return backoff ? new Date(Date.now() + backoff) : null;
}

/**
 * Stable per-event id: the same state of the same payment always yields the
 * same id across retries and manual resends, so merchants can dedupe.
 *
 * The received amount is part of the state. A second top-up on an underpaid
 * session is a new event with the same status; with `${id}:${status}` alone it
 * reused the first event's id, and merchants deduping on it dropped the update.
 */
export function webhookEventId(
  payment: Pick<Payment, "id" | "status" | "receivedAmount">,
) {
  return `${payment.id}:${payment.status}:${payment.receivedAmount ?? 0}`;
}

export function buildWebhookPayload(payment: Payment) {
  return {
    event: `payment.${payment.status}`,
    eventId: webhookEventId(payment),
    payment: {
      id: payment.id,
      externalId: payment.externalId,
      status: payment.status,
      paid: isPaidStatus(payment.status),
      chain: payment.chain,
      token: payment.token,
      expectedAmount: payment.expectedAmount,
      receivedAmount: payment.receivedAmount,
      txHash: payment.txHash,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    },
    timestamp: new Date().toISOString(),
  };
}

export interface WebhookSendResult {
  success: boolean;
  statusCode: number | null;
  response: string | null;
}

function truncate(text: string): string {
  return text.length > WEBHOOK_RESPONSE_MAX_CHARS
    ? `${text.slice(0, WEBHOOK_RESPONSE_MAX_CHARS)}…[truncated]`
    : text;
}

/**
 * POST a signed webhook payload. Never throws: network errors and timeouts
 * come back as a failed result so every caller logs them the same way.
 *
 * Redirects are NOT followed: a 3xx let an attacker bounce the request to the
 * cloud metadata endpoint and read it back (exploited against production on
 * 2026-09-26). A redirect is a failed delivery. postWebhook also re-checks
 * every resolved address at connect time, so DNS rebinding can't reach an
 * internal address either.
 */
export async function sendWebhookRequest({
  url,
  payload,
  secret,
}: {
  url: string;
  payload: { event: string; eventId: string };
  secret: string | null | undefined;
}): Promise<WebhookSendResult> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Id": payload.eventId,
  };
  if (secret) {
    headers["X-Signature"] = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");
  }

  try {
    const res = await postWebhook(url, {
      headers,
      body,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
    });

    if (res.status >= 300 && res.status < 400) {
      // Don't keep the body; just record where it tried to send us.
      return {
        success: false,
        statusCode: res.status,
        response: truncate(
          `Redirect not followed${res.location ? ` (Location: ${res.location})` : ""}`,
        ),
      };
    }

    return {
      success: res.ok,
      statusCode: res.status,
      response: truncate(res.text),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, statusCode: null, response: truncate(message) };
  }
}

/** A merchant may register this many webhook endpoints (one per site). */
export const MAX_WEBHOOK_ENDPOINTS = 10;

export interface EndpointRef {
  id: string;
  url: string;
  isActive: boolean;
  isDefault: boolean;
}

/**
 * The one URL a payment's webhooks go to, or null for none:
 *   1. its own `webhookUrl` (passed to the API, or its link's custom URL);
 *   2. the endpoint its payment link or API key named (`webhookEndpointId`);
 *   3. otherwise the merchant's default endpoint.
 * A paused or deleted endpoint receives nothing, and a payment routed to one
 * is never re-routed to another site's endpoint: one merchant can run several
 * sites, and a payment must reach only its own. Resolved at delivery, so a
 * fixed endpoint URL also receives pending retries.
 */
export function webhookTarget(
  payment: Pick<Payment, "webhookUrl" | "webhookEndpointId">,
  endpoints: readonly EndpointRef[],
): string | null {
  if (payment.webhookUrl) return payment.webhookUrl;
  const endpoint = payment.webhookEndpointId
    ? endpoints.find((e) => e.id === payment.webhookEndpointId)
    : endpoints.find((e) => e.isDefault);
  return endpoint?.isActive ? endpoint.url : null;
}

/** Whether the merchant can receive webhooks, their signing secret, and endpoints. */
export async function loadWebhookConfig(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      isActive: true,
      webhookSecret: true,
      webhookEndpoints: {
        select: { id: true, url: true, isActive: true, isDefault: true },
        take: MAX_WEBHOOK_ENDPOINTS,
      },
    },
  });
  return {
    /** Suspended or deleted accounts get no deliveries. */
    active: !!merchant?.isActive,
    secret: merchant?.webhookSecret ?? null,
    endpoints: (merchant?.webhookEndpoints ?? []) as EndpointRef[],
  };
}

/**
 * Deliver the merchant webhook for a payment's current status to its one
 * target (webhookTarget), log the attempt, and schedule a backoff retry on
 * failure. Safe to call from both the status-change path (triggerNotifications,
 * with `newEvent` to start a fresh retry budget) and the retry cron: each call
 * sends the payment's latest status and advances webhookAttempts. A successful
 * send clears nextWebhookRetryAt; a failure sets the next due time, or clears
 * it once the backoff schedule is exhausted.
 */
export async function deliverWebhook(
  payment: Payment,
  { newEvent = false }: { newEvent?: boolean } = {},
): Promise<void> {
  const { active, secret, endpoints } = await loadWebhookConfig(payment.merchantId);
  const url = active ? webhookTarget(payment, endpoints) : null;

  // No (longer a) deliverable target, or the account is suspended — make sure
  // a stale retry can't loop.
  if (!url || !(await isSafeWebhookUrl(url))) {
    if (payment.nextWebhookRetryAt) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { nextWebhookRetryAt: null },
      });
    }
    return;
  }

  const attempt = (newEvent ? 0 : payment.webhookAttempts) + 1;
  const payload = buildWebhookPayload(payment);
  const result = await sendWebhookRequest({ url, payload, secret });

  if (!result.success) {
    console.error(
      `Webhook delivery failed for payment ${payment.id} (attempt ${attempt}): ${result.statusCode ?? "no response"} ${result.response ?? ""}`,
    );
  }

  await prisma.webhookLog.create({
    data: {
      paymentId: payment.id,
      url,
      payload,
      statusCode: result.statusCode,
      response: result.response,
      attempt,
      success: result.success,
    },
  });

  await prisma.payment.update({
    where: { id: payment.id },
    data: result.success
      ? {
          webhookAttempts: attempt,
          webhookSentAt: new Date(),
          nextWebhookRetryAt: null,
        }
      : {
          webhookAttempts: attempt,
          nextWebhookRetryAt: nextWebhookRetryAt(attempt),
        },
  });
}
