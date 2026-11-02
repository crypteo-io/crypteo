import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { refuseEndpointChoice } from "@/lib/payment/webhook-endpoints";

// What the dashboard sees of a key. Never keyHash: only the raw key's owner
// should be able to tie a stored hash to a request.
const KEY_FIELDS = {
  id: true,
  createdAt: true,
  keyPrefix: true,
  label: true,
  lastUsedAt: true,
  isActive: true,
  isTest: true,
  webhookEndpointId: true,
} as const;

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await prisma.apiKey.findMany({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: KEY_FIELDS,
  });
  return NextResponse.json(keys);
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bodySchema = z.object({
    label: z.string().trim().max(100).optional(),
    isTest: z.boolean().optional().default(false),
    // Payments this key creates send webhooks here (one key per site).
    webhookEndpointId: z.string().trim().max(64).nullish(),
  });

  const rawBody = await req.json().catch(() => ({}));
  const parseResult = bodySchema.safeParse(rawBody);

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.format() },
      { status: 400 },
    );
  }

  const { label, isTest, webhookEndpointId } = parseResult.data;
  const endpointRefusal = await refuseEndpointChoice(session.user.id, webhookEndpointId);
  if (endpointRefusal) {
    return NextResponse.json(
      { error: endpointRefusal, field: "webhookEndpointId" },
      { status: 400 },
    );
  }
  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
  });

  if (!merchant) {
    console.error(
      `[API KEYS] Merchant not found for session user ID: ${session.user.id}`,
    );
    return NextResponse.json(
      { error: "Session expired or merchant not found. Please log in again." },
      { status: 401 },
    );
  }

  const prefixStr = isTest ? "test_" : "crypt_";
  const rawKey = `${prefixStr}${crypto.randomBytes(32).toString("hex").slice(0, 32)}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);

  const apiKey = await prisma.apiKey.create({
    data: {
      merchantId: session.user.id,
      keyHash,
      keyPrefix,
      label: label || null,
      isTest,
      webhookEndpointId: webhookEndpointId || null,
    },
    select: KEY_FIELDS,
  });

  // A new key is durable access that outlives the session that minted it, so a
  // stolen session would mint one first. Tell the owner. Not awaited: a mail
  // outage must not block or fail key creation.
  void notifyAccountSecurityChange({
    to: merchant.email,
    merchantName: merchant.name,
    action: isTest ? "Test API key created" : "Live API key created",
    details: [
      { label: "Key prefix", value: keyPrefix },
      { label: "Mode", value: isTest ? "Test" : "Live" },
      ...(label ? [{ label: "Label", value: label }] : []),
    ],
    ip: clientIp(req),
    reviewPath: "/dashboard/api-keys",
    role: session.user.role,
  });

  return NextResponse.json({ rawKey, apiKey });
}

// PATCH /api/api-keys — choose where a key's payments send webhooks.
export async function PATCH(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = z
    .object({ id: z.string().min(1), webhookEndpointId: z.string().trim().max(64).nullable() })
    .safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { id, webhookEndpointId } = parsed.data;

  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey || apiKey.merchantId !== session.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const endpointRefusal = await refuseEndpointChoice(session.user.id, webhookEndpointId);
  if (endpointRefusal) {
    return NextResponse.json(
      { error: endpointRefusal, field: "webhookEndpointId" },
      { status: 400 },
    );
  }

  // Applies to payments this key creates from now on; existing payments keep
  // the destination they were created with.
  const updated = await prisma.apiKey.update({
    where: { id },
    data: { webhookEndpointId },
    select: KEY_FIELDS,
  });
  return NextResponse.json({ success: true, apiKey: updated });
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const deleteSchema = z.object({
    id: z.string().min(1),
  });

  const rawBody = await req.json().catch(() => ({}));
  const parseResult = deleteSchema.safeParse(rawBody);

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parseResult.error.format() },
      { status: 400 },
    );
  }

  const { id } = parseResult.data;
  const apiKey = await prisma.apiKey.findUnique({ where: { id } });
  if (!apiKey || apiKey.merchantId !== session.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.apiKey.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
