import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import {
  buildWebhookPayload,
  sendWebhookRequest,
  loadWebhookConfig,
  webhookTarget,
} from "@/lib/payment/notify";
import { isSafeWebhookUrl } from "@/lib/security";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  // Every call is an outbound POST to a stored URL; keep manual resends to a
  // human pace rather than the general API allowance.
  const scoped = await rateLimitScoped(req, "webhook-resend", 10);
  if (scoped) return scoped;

  // This endpoint triggers an outbound POST to a merchant's webhook URL, so it
  // must be authenticated and ownership-checked — otherwise anyone could force
  // webhook deliveries (spam) or use a stored internal URL as an SSRF pivot.
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { paymentId: urlId } = await params;
  const body = await req.json().catch(() => ({}));
  const bodyId = body.paymentId || body.data?.paymentId;

  const targetId = bodyId || urlId;

  if (!targetId || targetId === "crypteo") {
    return NextResponse.json(
      { error: "Payment ID is required" },
      { status: 400 },
    );
  }

  const payment = await prisma.payment.findUnique({
    where: { id: targetId },
  });
  if (!payment)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (payment.merchantId !== session.user.id && session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { active, secret, endpoints } = await loadWebhookConfig(payment.merchantId);
  // An admin can open a suspended merchant's payment; nothing is sent for it.
  if (!active)
    return NextResponse.json({ error: "This account is suspended" }, { status: 403 });
  const url = webhookTarget(payment, endpoints);
  if (!url)
    return NextResponse.json({ error: "No webhook endpoint for this payment" }, { status: 404 });

  if (!(await isSafeWebhookUrl(url)))
    return NextResponse.json(
      { error: "Webhook URL is not a public address" },
      { status: 400 },
    );

  // Same signed, redirect-refusing, time-bounded delivery as the automatic
  // path — an unsigned resend would be rejected by merchants who verify
  // X-Signature, and following redirects here would reopen the SSRF.
  const payload = buildWebhookPayload(payment);
  const { success, statusCode, response } = await sendWebhookRequest({
    url,
    payload,
    secret,
  });

  // Logged with the attempt number the automatic schedule is on, but it does
  // not advance that schedule: webhookAttempts indexes the backoff table, so a
  // manual resend that incremented it made the next automatic retry skip a
  // step (and a few clicks exhausted the whole budget).
  await prisma.webhookLog.create({
    data: {
      paymentId: payment.id,
      url,
      payload,
      statusCode,
      response,
      success,
      attempt: Math.max(payment.webhookAttempts, 1),
    },
  });

  // A manual success delivers the current event, so a queued automatic retry
  // of it would only be a duplicate. A manual failure leaves the automatic
  // schedule exactly as it was.
  if (success) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { webhookSentAt: new Date(), nextWebhookRetryAt: null },
    });
  }

  return NextResponse.json({ success, statusCode, url });
}
