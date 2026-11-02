import { flagProbeInput } from "@/lib/abuse-signals";
import { validateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { positiveAmountSchema, refuseLinkPin } from "@/lib/payment/assign";
import { rateLimit } from "@/lib/rate-limit";
import { refuseEndpointChoice } from "@/lib/payment/webhook-endpoints";
import { isSafeWebhookUrl } from "@/lib/security";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;
  const authResult = await validateApiKey(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { merchant, isTest } = authResult;

  // A payment link has no test mode: every session /pay/[id] mints from it is
  // live and watched on the merchant's real wallets. Accepting a test key here
  // let anyone holding one (including the public playground key) create live
  // links, so test keys are refused outright.
  if (isTest) {
    return NextResponse.json(
      {
        error:
          "Payment links cannot be created with a test API key: every payment made through a link is live. Use a live key.",
      },
      { status: 403 },
    );
  }

  try {
    const createSchema = z.object({
      title: z.string().min(1, "Title is required"),
      description: z.string().optional().nullable(),
      // Link amounts are USD; a zero/negative/NaN one mints unpayable sessions.
      amount: positiveAmountSchema,
      walletAddress: z.string().optional().nullable(),
      // Where this link's payments send webhooks: a custom URL or one of the
      // merchant's endpoints; neither = the default endpoint.
      webhookUrl: z.string().trim().max(2048).optional().nullable(),
      webhookEndpointId: z.string().trim().max(64).optional().nullable(),
      chain: z.string().optional().nullable(),
      token: z.string().optional().nullable(),
      expiresAt: z.string().optional().nullable(),
      paymentLimit: z.union([z.string(), z.number()]).optional().nullable(),
    });

    const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const {
      title,
      description,
      amount,
      walletAddress,
      webhookUrl,
      webhookEndpointId,
      chain,
      token,
      expiresAt,
      paymentLimit,
    } = parsed.data;

    let parsedExpiresAt = null;
    if (expiresAt) {
      parsedExpiresAt = new Date(expiresAt);
      if (isNaN(parsedExpiresAt.getTime())) {
        return NextResponse.json(
          { error: "Invalid expiresAt date format" },
          { status: 400 },
        );
      }
    }

    const parsedPaymentLimit =
      typeof paymentLimit === "string"
        ? parseInt(paymentLimit)
        : (paymentLimit ?? null);

    // A pinned pair must be one checkout will accept (supported, with a valid
    // active wallet), and a link never carries an address of its own.
    const pinnedChain = chain?.trim().toLowerCase() || null;
    const pinnedToken = token?.trim().toLowerCase() || null;
    const pinRefusal = await refuseLinkPin({
      merchantId: merchant.id,
      chain: pinnedChain,
      token: pinnedToken,
      walletAddress,
    });
    if (pinRefusal) {
      return NextResponse.json({ error: pinRefusal, field: "chain" }, { status: 400 });
    }
    if (webhookUrl && webhookEndpointId) {
      return NextResponse.json(
        { error: "Choose either a webhook endpoint or a custom webhook URL, not both.", field: "webhookUrl" },
        { status: 400 },
      );
    }
    const endpointRefusal = await refuseEndpointChoice(merchant.id, webhookEndpointId);
    if (endpointRefusal) {
      return NextResponse.json({ error: endpointRefusal, field: "webhookUrl" }, { status: 400 });
    }
    if (webhookUrl && !(await isSafeWebhookUrl(webhookUrl))) {
      return NextResponse.json(
        { error: "Webhook URL must be a public HTTP or HTTPS address.", field: "webhookUrl" },
        { status: 400 },
      );
    }
    if (
      parsedPaymentLimit !== null &&
      (!Number.isInteger(parsedPaymentLimit) || parsedPaymentLimit < 1)
    ) {
      return NextResponse.json(
        { error: "paymentLimit must be a positive integer" },
        { status: 400 },
      );
    }

    const payLink = await prisma.paymentLink.create({
      data: {
        merchantId: merchant.id,
        title,
        description: description || null,
        amount,
        walletAddress: null,
        webhookUrl: webhookUrl || null,
        webhookEndpointId: webhookUrl ? null : webhookEndpointId || null,
        chain: pinnedChain,
        token: pinnedToken,
        expiresAt: parsedExpiresAt,
        paymentLimit: parsedPaymentLimit,
        isActive: true,
      },
    });

    await flagProbeInput(merchant.id, "Payment link (API)", { title, description });
    return NextResponse.json({
      success: true,
      paymentLink: {
        id: payLink.id,
        url: `${process.env.NEXTAUTH_URL}/pay/${payLink.id}`,
        title: payLink.title,
        amount: payLink.amount,
        isActive: payLink.isActive,
        expiresAt: payLink.expiresAt,
        webhookUrl: payLink.webhookUrl,
        webhookEndpointId: payLink.webhookEndpointId,
      },
    });
  } catch (error) {
    console.error("Public API Create payment link error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
