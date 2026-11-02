import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { ENDPOINT_FIELDS, endpointInputSchema } from "@/lib/payment/webhook-endpoints";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isSafeWebhookUrl } from "@/lib/security";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const patchSchema = endpointInputSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
    // Only `true`: the default moves to another endpoint, it isn't cleared.
    isDefault: z.literal(true).optional(),
  });

async function ownEndpoint(id: string, merchantId: string) {
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id } });
  return endpoint && endpoint.merchantId === merchantId ? endpoint : null;
}

// PATCH /api/merchants/webhook-endpoints/[id] — rename, re-point, or pause.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await ownEndpoint(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid endpoint", field: "url" },
      { status: 400 },
    );
  }
  const { url, label, isActive, isDefault } = parsed.data;
  const urlChanged = url !== undefined && url !== existing.url;

  if (urlChanged) {
    if (!(await isSafeWebhookUrl(url))) {
      return NextResponse.json(
        { error: "Webhook URL must be a public HTTP or HTTPS address.", field: "url" },
        { status: 400 },
      );
    }
    const duplicate = await prisma.webhookEndpoint.findUnique({
      where: { merchantId_url: { merchantId: session.user.id, url } },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "This URL is already one of your endpoints.", field: "url" },
        { status: 409 },
      );
    }
  }

  // One default per merchant: moving it clears the others in the same write.
  const endpoint = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.webhookEndpoint.updateMany({
        where: { merchantId: session.user.id, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.webhookEndpoint.update({
      where: { id },
      data: {
        ...(urlChanged ? { url } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
        ...(isDefault ? { isDefault: true } : {}),
      },
      select: ENDPOINT_FIELDS,
    });
  });

  if (urlChanged) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true },
    });
    if (merchant) {
      void notifyAccountSecurityChange({
        to: merchant.email,
        merchantName: merchant.name,
        action: "Webhook endpoint changed",
        details: [
          { label: "From", value: existing.url },
          { label: "To", value: endpoint.url },
        ],
        ip: clientIp(req),
        reviewPath: "/dashboard/settings?tab=webhooks",
        role: session.user.role,
      });
    }
  }

  return NextResponse.json({ success: true, endpoint });
}

// DELETE /api/merchants/webhook-endpoints/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await ownEndpoint(id, session.user.id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Payments from a key or link that names this endpoint would have nowhere
  // to go (they are never re-routed to another site), so those must be moved
  // first. Pausing is always allowed.
  const [keys, links] = await Promise.all([
    prisma.apiKey.count({
      where: { merchantId: session.user.id, isActive: true, webhookEndpointId: id },
    }),
    prisma.paymentLink.count({
      where: { merchantId: session.user.id, isActive: true, webhookEndpointId: id },
    }),
  ]);
  if (keys + links > 0) {
    const uses = [
      keys ? `${keys} API key${keys === 1 ? "" : "s"}` : null,
      links ? `${links} payment link${links === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    return NextResponse.json(
      {
        error: `${uses} send${keys + links === 1 ? "s" : ""} webhooks to this endpoint. Point ${keys + links === 1 ? "it" : "them"} at another endpoint (API keys) or deactivate ${keys + links === 1 ? "it" : "them"} (links) first, or pause the endpoint instead.`,
      },
      { status: 409 },
    );
  }

  await prisma.webhookEndpoint.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
