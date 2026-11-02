import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// The secret keys the HMAC merchants verify with. Bounded so it can't be a
// trivially guessable one-character key or an arbitrarily large blob, and
// restricted to printable ASCII without spaces so it survives copy/paste into
// every merchant's config identically. Empty/null clears it.
// Endpoints themselves live in /api/merchants/webhook-endpoints; this route
// manages the one signing secret every endpoint's deliveries share.
const webhookSchema = z.object({
  webhookSecret: z
    .union([
      z.literal(""),
      z
        .string()
        .min(16, "Webhook secret must be at least 16 characters")
        .max(256, "Webhook secret must be at most 256 characters")
        .regex(
          /^[\x21-\x7e]+$/,
          "Webhook secret may only contain printable ASCII characters without spaces",
        ),
    ])
    .nullish(),
});

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { webhookSecret: true },
  });

  return NextResponse.json({
    webhookSecret: merchant?.webhookSecret || null,
  });
}

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = webhookSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid webhook settings" },
      { status: 400 },
    );
  }
  const { webhookSecret } = parsed.data;

  await prisma.merchant.update({
    where: { id: session.user.id },
    data: { webhookSecret: webhookSecret || null },
  });

  return NextResponse.json({ success: true });
}
