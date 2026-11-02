import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { otpRecentlySent } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";
import { effectiveTwoFactorMethod, issueChallenge } from "@/lib/two-factor";
import { NextRequest, NextResponse } from "next/server";

/**
 * Starts a wallet change: the code POST /api/wallets needs before it saves a
 * new or changed receiving address. Within the resend cooldown the open
 * challenge stands, so repeated requests neither flood the inbox nor reset
 * the guess count.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: { email: true, role: true, twoFactorMethod: true, totpSecret: true },
  });
  if (!merchant) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const method = (await otpRecentlySent(merchant.email, "WALLET_CHANGE"))
    ? effectiveTwoFactorMethod(merchant)
    : await issueChallenge(merchant, "WALLET_CHANGE");
  return NextResponse.json({ method });
}
