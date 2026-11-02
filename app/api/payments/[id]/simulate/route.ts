import { prisma } from "@/lib/db";
import { testPaymentHtml } from "@/lib/emails/templates";
import { sendEmail } from "@/lib/mailer";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Each successful simulation sends the merchant an email, and anyone holding a
// test key can mint test sessions to simulate, so this gets a tighter per-IP
// bucket than the general 60/min.
const SIMULATE_LIMIT_PER_MIN = 10;

// Exactly what the hosted checkout renders — the same allow-list as
// GET /api/payments/[id]. This endpoint is unauthenticated (the public test
// checkout calls it), so it must never return merchant-side fields: it used to
// return the whole Payment row (webhookUrl, metadata, customerEmail) and the
// whole Merchant row (password hash, webhookSecret, email).
const CHECKOUT_FIELDS = {
  id: true,
  status: true,
  chain: true,
  token: true,
  expectedAmount: true,
  receivedAmount: true,
  walletAddress: true,
  xrpDestinationTag: true,
  solMemoString: true,
  txHash: true,
  confirmations: true,
  createdAt: true,
  expiresAt: true,
  isTest: true,
} as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;
    const scoped = await rateLimitScoped(req, "simulate", SIMULATE_LIMIT_PER_MIN);
    if (scoped) return scoped;

    const { id } = await params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        ...CHECKOUT_FIELDS,
        customerEmail: true,
        merchant: { select: { name: true, email: true } },
      },
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (!payment.isTest) {
      return NextResponse.json(
        { error: "Cannot simulate live payment" },
        { status: 400 },
      );
    }

    // Conditional write: only the call that actually flips the status sends
    // the email. A read-then-update let concurrent calls each pass the
    // "already confirmed?" check and each email the merchant. isTest is in the
    // filter so this can never touch a live session whatever happens above.
    const { count } = await prisma.payment.updateMany({
      where: { id, isTest: true, status: { not: "confirmed" } },
      data: {
        status: "confirmed",
        receivedAmount: payment.expectedAmount,
        confirmations: 12, // Simulate full confirmations
      },
    });

    const current = await prisma.payment.findUnique({
      where: { id },
      select: CHECKOUT_FIELDS,
    });

    // Idempotent: already confirmed means no re-processing and no re-email.
    if (count === 0) {
      return NextResponse.json({ success: true, payment: current });
    }

    // Send email notification using mailer buffer for merchant. The template
    // escapes every interpolated value: customerEmail arrives through the
    // public API (a test key is enough) and would otherwise inject HTML into
    // the merchant's inbox.
    try {
      if (payment.merchant.email) {
        await sendEmail({
          to: payment.merchant.email,
          subject: "Test Payment Received!",
          html: testPaymentHtml({
            merchantName: payment.merchant.name || "Merchant",
            paymentId: payment.id,
            amount: payment.expectedAmount,
            token: payment.token,
            customerEmail: payment.customerEmail,
            dashboardUrl: `${process.env.NEXTAUTH_URL || "https://crypteo.io"}/dashboard/payments/${payment.id}`,
          }),
        });

        await prisma.emailLog.create({
          data: {
            paymentId: payment.id,
            type: "merchant_success",
            recipient: payment.merchant.email,
            subject: "Test Payment Received!",
          },
        });
      }
    } catch (err) {
      console.error("Failed to send simulation test email", err);
    }

    return NextResponse.json({ success: true, payment: current });
  } catch (error) {
    console.error("Simulation error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
