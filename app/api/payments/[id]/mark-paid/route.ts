import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { triggerNotifications } from "@/lib/payment/notify";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Merchant override for an underpaid session: accept the actual amount received
// as full settlement. The received amount is left untouched so the true credited
// figure is preserved, and the status flips to "confirmed" so downstream
// webhooks/API reflect a completed payment.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;

  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const payment = await prisma.payment.findUnique({ where: { id } });

  if (!payment || payment.merchantId !== session.user.id)
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  // Test payments are advanced via the simulate endpoint and must never emit a
  // live webhook/email, matching the isTest: false invariant everywhere else.
  if (payment.isTest)
    return NextResponse.json(
      { error: "Cannot mark a test payment as paid" },
      { status: 400 },
    );

  // Both hold real funds that fell short of completing the session: underpaid
  // (still open) and expired_received (funds arrived after expiry).
  if (payment.status !== "underpaid" && payment.status !== "expired_received")
    return NextResponse.json(
      {
        error:
          "Only underpaid or partially-received expired payments can be marked as paid",
      },
      { status: 400 },
    );

  if (!payment.receivedAmount || payment.receivedAmount <= 0)
    return NextResponse.json(
      { error: "No received amount to credit" },
      { status: 400 },
    );

  // Conditional on the status we just validated: the worker may have moved the
  // session in between (a top-up confirming it, expiry), and a blind write
  // would overwrite that and fire a second, contradictory notification.
  const { count } = await prisma.payment.updateMany({
    where: { id, status: payment.status },
    data: { status: "confirmed" },
  });
  if (count === 0)
    return NextResponse.json(
      { error: "This payment changed while you were viewing it. Reload and try again." },
      { status: 409 },
    );

  const updated = await prisma.payment.findUniqueOrThrow({ where: { id } });

  // The status change is already committed; a notification failure must not fail
  // the request (and prompt a confusing retry against a now-confirmed payment).
  try {
    await triggerNotifications(updated);
  } catch (err) {
    console.error(`mark-paid: notifications failed for ${id}:`, err);
  }

  return NextResponse.json({ success: true, payment: updated });
}
