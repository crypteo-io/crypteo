import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { MAX_WEBHOOK_ENDPOINTS } from "@/lib/payment/notify";
import { ENDPOINT_FIELDS, endpointInputSchema } from "@/lib/payment/webhook-endpoints";
import { webhookHealth } from "@/lib/payment/webhook-health";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isSafeWebhookUrl } from "@/lib/security";
import { NextRequest, NextResponse } from "next/server";

// GET /api/merchants/webhook-endpoints — the merchant's endpoints with their
// recent delivery health.
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchantId = session.user.id;
  const [endpoints, health, keys, links] = await Promise.all([
    prisma.webhookEndpoint.findMany({
      where: { merchantId },
      orderBy: { createdAt: "asc" },
      select: ENDPOINT_FIELDS,
    }),
    webhookHealth(merchantId),
    prisma.apiKey.groupBy({
      by: ["webhookEndpointId"],
      where: { merchantId, isActive: true, webhookEndpointId: { not: null } },
      _count: { _all: true },
    }),
    prisma.paymentLink.groupBy({
      by: ["webhookEndpointId"],
      where: { merchantId, isActive: true, webhookEndpointId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const byUrl = new Map(health.map((h) => [h.url, h]));
  const keyCount = new Map(keys.map((k) => [k.webhookEndpointId, k._count._all]));
  const linkCount = new Map(links.map((l) => [l.webhookEndpointId, l._count._all]));

  return NextResponse.json({
    endpoints: endpoints.map((e) => ({
      ...e,
      health: byUrl.get(e.url) ?? null,
      apiKeys: keyCount.get(e.id) ?? 0,
      paymentLinks: linkCount.get(e.id) ?? 0,
    })),
    max: MAX_WEBHOOK_ENDPOINTS,
  });
}

// POST /api/merchants/webhook-endpoints — add one (one per site).
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = endpointInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid endpoint", field: "url" },
      { status: 400 },
    );
  }
  const { url, label } = parsed.data;
  if (!(await isSafeWebhookUrl(url))) {
    return NextResponse.json(
      { error: "Webhook URL must be a public HTTP or HTTPS address.", field: "url" },
      { status: 400 },
    );
  }

  const merchantId = session.user.id;
  const count = await prisma.webhookEndpoint.count({ where: { merchantId } });
  if (count >= MAX_WEBHOOK_ENDPOINTS) {
    return NextResponse.json(
      { error: `You can add up to ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints.` },
      { status: 400 },
    );
  }
  const duplicate = await prisma.webhookEndpoint.findUnique({
    where: { merchantId_url: { merchantId, url } },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "This URL is already one of your endpoints.", field: "url" },
      { status: 409 },
    );
  }

  // The first endpoint becomes the default: with none, payments not routed
  // by their link or API key would notify no one.
  const hasDefault = await prisma.webhookEndpoint.count({
    where: { merchantId, isDefault: true },
  });
  const endpoint = await prisma.webhookEndpoint.create({
    data: { merchantId, url, label, isDefault: hasDefault === 0 },
    select: ENDPOINT_FIELDS,
  });

  // Payment notifications now also go to this URL: like a new wallet or API
  // key, a stolen session could add one, so the owner hears about it.
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { email: true, name: true },
  });
  if (merchant) {
    void notifyAccountSecurityChange({
      to: merchant.email,
      merchantName: merchant.name,
      action: "Webhook endpoint added",
      details: [
        { label: "URL", value: url },
        ...(label ? [{ label: "Label", value: label }] : []),
      ],
      ip: clientIp(req),
      reviewPath: "/dashboard/settings?tab=webhooks",
      role: session.user.role,
    });
  }

  return NextResponse.json({
    success: true,
    endpoint: { ...endpoint, health: null, apiKeys: 0, paymentLinks: 0 },
  });
}
