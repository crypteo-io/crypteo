import { auth } from "@/lib/auth";
import {
  PAYMENT_TOLERANCE,
  UNDERPAID_THRESHOLD_MAX,
  UNDERPAID_THRESHOLD_MIN,
} from "@/lib/chains/config";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { underpaidThreshold: true },
  });

  return NextResponse.json({
    underpaidThreshold:
      merchant?.underpaidThreshold ?? PAYMENT_TOLERANCE.confirmed_from,
  });
}

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = Number(body.underpaidThreshold);
  // Snap to whole-percent granularity so the stored ratio round-trips exactly
  // through the percentage the UI displays (no 0.955 → "96%" drift).
  const value = Math.round(raw * 100) / 100;

  if (
    !Number.isFinite(raw) ||
    value < UNDERPAID_THRESHOLD_MIN ||
    value > UNDERPAID_THRESHOLD_MAX
  )
    return NextResponse.json(
      {
        error: `Threshold must be between ${UNDERPAID_THRESHOLD_MIN * 100}% and ${UNDERPAID_THRESHOLD_MAX * 100}%`,
      },
      { status: 400 },
    );

  await prisma.merchant.update({
    where: { id: session.user.id },
    data: { underpaidThreshold: value },
  });

  return NextResponse.json({ success: true, underpaidThreshold: value });
}
