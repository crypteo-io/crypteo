import { validateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { isSafeWebhookUrl } from "@/lib/security";
import { returnUrlSchema } from "@/lib/validation";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AssignmentFields,
  ORIGINAL_USD_KEY,
  positiveAmountSchema,
  resolveAssignment,
} from "@/lib/payment/assign";
import { generateSessionIdentifiers } from "@/lib/payment/identifiers";

export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;
  const authResult = await validateApiKey(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { merchant, isTest, webhookEndpointId } = authResult;

  try {
    const createSchema = z
      .object({
        chain: z.string().trim().max(16).toLowerCase().optional().nullable(),
        token: z.string().trim().max(16).toLowerCase().optional().nullable(),
        amount: positiveAmountSchema.optional().nullable(),
        expectedAmount: positiveAmountSchema.optional().nullable(),
        customerEmail: z
          .string()
          .email()
          .optional()
          .nullable()
          .or(z.literal("")),
        externalId: z.string().max(200).optional().nullable(),
        webhookUrl: z.string().url().optional().nullable().or(z.literal("")),
        successUrl: returnUrlSchema.optional().nullable().or(z.literal("")),
        cancelUrl: returnUrlSchema.optional().nullable().or(z.literal("")),
        metadata: z.record(z.string(), z.unknown()).optional().nullable(),
      })
      .refine((data) => data.amount != null || data.expectedAmount != null, {
        message: "Either amount or expectedAmount must be provided",
        path: ["amount"],
      })
      .refine((data) => !!data.chain === !!data.token, {
        message: "chain and token must be provided together",
        path: ["chain"],
      });

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const {
      chain: rawChain,
      token: rawToken,
      amount,
      expectedAmount,
      customerEmail,
      externalId,
      webhookUrl,
      successUrl,
      cancelUrl,
      metadata: rawMetadata,
    } = parsed.data;

    if (webhookUrl && !(await isSafeWebhookUrl(webhookUrl))) {
      return NextResponse.json(
        { error: "webhookUrl must resolve to a public http(s) address" },
        { status: 400 },
      );
    }

    const chain = rawChain || null;
    const token = rawToken || null;
    // Both are validated finite and > 0; the refine guarantees one is set.
    const finalAmount = (amount ?? expectedAmount)!;

    // Denomination is fixed at creation. Without a chain the amount is USD
    // and every chain selection prices from this recorded figure; with a chain
    // it is a token amount the buyer cannot reprice. The key is reserved, so a
    // merchant-supplied value is never trusted.
    const metadata: Record<string, unknown> = { ...(rawMetadata ?? {}) };
    delete metadata[ORIGINAL_USD_KEY];
    if (!chain) metadata[ORIGINAL_USD_KEY] = finalAmount;

    let assigned: AssignmentFields | null = null;
    if (chain && token) {
      if (isTest) {
        assigned = {
          chain,
          token,
          walletAddress: `test_${chain}_address_xyz`,
          balanceSnapshot: 0,
          snapshotAt: new Date(),
          snapshotBasis: null,
          expectedAmount: finalAmount,
          ...generateSessionIdentifiers(chain),
        };
      } else {
        const assignment = await resolveAssignment({
          merchantId: merchant.id,
          chain,
          token,
          amount: { crypto: finalAmount },
          context: "public_api_create",
        });
        if (!assignment.ok) {
          return NextResponse.json(
            { error: assignment.error },
            { status: assignment.status, headers: assignment.headers },
          );
        }
        assigned = assignment.fields;
      }
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const payment = await prisma.payment.create({
      data: {
        merchant: { connect: { id: merchant.id } },
        isTest,
        chain,
        token,
        expectedAmount: finalAmount,
        ...(assigned ?? {}),
        status: "pending",
        pollInterval: 15,
        pollPhase: "phase1",
        nextPollAt: new Date(Date.now() + 15000),
        externalId,
        // An explicit URL wins; otherwise the key's endpoint (one key per
        // site), otherwise the merchant's default (lib/payment/notify.ts).
        webhookUrl: webhookUrl || null,
        webhookEndpointId: webhookUrl ? null : webhookEndpointId,
        successUrl: successUrl || null,
        cancelUrl: cancelUrl || null,
        metadata:
          Object.keys(metadata).length > 0
            ? (metadata as Prisma.InputJsonValue)
            : undefined,
        customerEmail: customerEmail || null,
        expiresAt,
      },
    });

    return NextResponse.json({
      success: true,
      payment: {
        id: payment.id,
        checkoutUrl: `${process.env.NEXTAUTH_URL}/checkout/${payment.id}`,
        walletAddress: payment.walletAddress,
        amount: payment.expectedAmount,
        chain: payment.chain,
        token: payment.token,
        expiresAt: payment.expiresAt,
        xrpDestinationTag: payment.xrpDestinationTag || null,
        solMemoString: payment.solMemoString || null,
      },
    });
  } catch (error) {
    console.error("Public API Create payment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
