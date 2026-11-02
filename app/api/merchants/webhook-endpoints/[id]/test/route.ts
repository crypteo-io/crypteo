import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendWebhookRequest } from "@/lib/payment/notify";
import { testWebhookPayload } from "@/lib/payment/webhook-endpoints";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { isSafeWebhookUrl } from "@/lib/security";
import { NextRequest, NextResponse } from "next/server";

// POST /api/merchants/webhook-endpoints/[id]/test — send a signed
// `webhook.test` event so the merchant can check the URL before a real
// payment depends on it (a frontend URL answering 405 shows up here at once).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  // Every call is an outbound POST: keep it to a human pace.
  const scoped = await rateLimitScoped(req, "webhook-test", 10);
  if (scoped) return scoped;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id } });
  if (!endpoint || endpoint.merchantId !== session.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await isSafeWebhookUrl(endpoint.url)))
    return NextResponse.json(
      { error: "Webhook URL is not a public address" },
      { status: 400 },
    );

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { webhookSecret: true },
  });
  const result = await sendWebhookRequest({
    url: endpoint.url,
    payload: testWebhookPayload(endpoint.id),
    secret: merchant?.webhookSecret,
  });

  // The endpoint's answer is merchant-controlled: return only the status and
  // a short excerpt, never more than sendWebhookRequest already capped.
  return NextResponse.json({
    success: result.success,
    statusCode: result.statusCode,
    response: result.response?.slice(0, 300) ?? null,
  });
}
