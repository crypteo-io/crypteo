import { auth } from "@/lib/auth";
import { openFeeCheckout } from "@/lib/billing/checkout";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/** Open (or reuse) the hosted checkout that pays one of the merchant's invoices. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const result = await openFeeCheckout(session.user.id, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ checkoutUrl: `/checkout/${result.paymentId}` });
  } catch (error) {
    console.error("[billing/pay]", error);
    return NextResponse.json({ error: "Could not open the payment page" }, { status: 500 });
  }
}
