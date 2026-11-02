import { flagProbeInput } from "@/lib/abuse-signals";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { positiveAmountSchema, refuseLinkPin } from "@/lib/payment/assign";
import { rateLimit } from "@/lib/rate-limit";
import { refuseEndpointChoice } from "@/lib/payment/webhook-endpoints";
import { isSafeWebhookUrl } from "@/lib/security";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// GET /api/payment-links
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const links = await prisma.paymentLink.findMany({
      where: { merchantId: session.user.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, paymentLinks: links });
  } catch (error) {
    console.error("Fetch payment links error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/payment-links
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (expiresAt && expiresAt !== "never") {
      const days = parseInt(expiresAt.split(" ")[0]);
      if (!isNaN(days)) {
        parsedExpiresAt = new Date();
        if (expiresAt.includes("year")) {
          parsedExpiresAt.setFullYear(parsedExpiresAt.getFullYear() + 1);
        } else {
          parsedExpiresAt.setDate(parsedExpiresAt.getDate() + days);
        }
      }
    }

    let parsedPaymentLimit = null;
    if (typeof paymentLimit === "string" && paymentLimit !== "never") {
      if (paymentLimit === "once") parsedPaymentLimit = 1;
      else if (paymentLimit.includes("payments")) {
        parsedPaymentLimit = parseInt(paymentLimit.split(" ")[0]);
      } else {
        parsedPaymentLimit = parseInt(paymentLimit); // custom
      }
    } else if (typeof paymentLimit === "number") {
      parsedPaymentLimit = paymentLimit;
    }

    // A pinned pair must be one checkout will accept (supported, with a valid
    // active wallet), and a link never carries an address of its own.
    const pinnedChain = chain?.trim().toLowerCase() || null;
    const pinnedToken = token?.trim().toLowerCase() || null;
    const pinRefusal = await refuseLinkPin({
      merchantId: session.user.id,
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
    const endpointRefusal = await refuseEndpointChoice(session.user.id, webhookEndpointId);
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
        merchantId: session.user.id,
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

    await flagProbeInput(session.user.id, "Payment link", { title, description });
    return NextResponse.json({ success: true, paymentLink: payLink });
  } catch (error) {
    console.error("Create payment link error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
