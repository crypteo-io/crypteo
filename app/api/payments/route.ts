import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import {
  ORIGINAL_USD_KEY,
  positiveAmountSchema,
  resolveAssignment,
} from "@/lib/payment/assign";
import { isSafeWebhookUrl } from "@/lib/security";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const createSchema = z.object({
      // The dashboard route always binds a wallet at creation, so the amount
      // is denominated in the token and chain/token are required.
      chain: z.string().trim().min(1).max(16).toLowerCase(),
      token: z.string().trim().min(1).max(16).toLowerCase(),
      expectedAmount: positiveAmountSchema,
      customerEmail: z.string().email().optional().nullable().or(z.literal("")),
      externalId: z.string().max(200).optional().nullable(),
      webhookUrl: z.string().url().optional().nullable().or(z.literal("")),
      metadata: z.record(z.string(), z.unknown()).optional().nullable(),
    });

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format", details: parsed.error.format() },
        { status: 400 },
      );
    }
    const {
      chain,
      token,
      expectedAmount,
      customerEmail,
      externalId,
      webhookUrl,
      metadata: rawMetadata,
    } = parsed.data;

    if (webhookUrl && !(await isSafeWebhookUrl(webhookUrl))) {
      return NextResponse.json(
        { error: "webhookUrl must resolve to a public http(s) address" },
        { status: 400 },
      );
    }

    // Token-denominated: the reserved USD-base key must not be present, or the
    // buyer could reprice the session through the checkout's chain selection.
    const metadata: Record<string, unknown> = { ...(rawMetadata ?? {}) };
    delete metadata[ORIGINAL_USD_KEY];

    const assignment = await resolveAssignment({
      merchantId: session.user.id,
      chain,
      token,
      amount: { crypto: expectedAmount },
      context: "dashboard_create",
    });
    if (!assignment.ok) {
      return NextResponse.json(
        { error: assignment.error },
        { status: assignment.status, headers: assignment.headers },
      );
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hr

    const payment = await prisma.payment.create({
      data: {
        merchantId: session.user.id,
        ...assignment.fields,
        status: "pending",
        pollInterval: 15,
        pollPhase: "phase1",
        nextPollAt: new Date(Date.now() + 15000),
        externalId,
        webhookUrl: webhookUrl || null,
        metadata:
          Object.keys(metadata).length > 0
            ? (metadata as Prisma.InputJsonValue)
            : undefined,
        customerEmail: customerEmail || null,
        expiresAt,
      },
    });

    return NextResponse.json({
      id: payment.id,
      status: payment.status,
      walletAddress: payment.walletAddress,
      expectedAmount: payment.expectedAmount,
      xrpDestinationTag: payment.xrpDestinationTag,
      solMemoString: payment.solMemoString,
      expiresAt: payment.expiresAt,
      checkoutUrl: `${process.env.NEXTAUTH_URL}/checkout/${payment.id}`,
    });
  } catch (error) {
    console.error("Create payment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  // Clamped: an unbounded limit let one request pull every row, and a
  // non-numeric page (NaN skip) made Prisma throw a 500.
  const page = clampInt(searchParams.get("page"), 1, 1, 100_000);
  const limit = clampInt(searchParams.get("limit"), 10, 1, 100);

  const where = { merchantId: session.user.id, ...(status ? { status } : {}) };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  return NextResponse.json({
    payments,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
