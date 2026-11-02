import { prisma } from "@/lib/db";
import {
  canReassign,
  commitAssignment,
  metadataObject,
  ORIGINAL_USD_KEY,
  resolveAssignment,
  usdBase,
} from "@/lib/payment/assign";
import { offerableWallets, sessionTokenRefusal, sessionWallets } from "@/lib/payment/wallets";
import { rateLimit } from "@/lib/rate-limit";
import { AvailableWallet } from "@/types/payment";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Unauthenticated: this is the hosted checkout's own API, reachable by anyone
// holding the session id. It returns only what the checkout renders — never
// merchant-side fields (webhookUrl, metadata, customerEmail, merchantId,
// balanceSnapshot, senderAddress, poll state).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { paymentLink: { select: { title: true, description: true } } },
  });

  if (!payment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If chain is not selected, return available wallets for this merchant
  let availableWallets: AvailableWallet[] = [];
  if (!payment.chain) {
    const rawWallets = await prisma.wallet.findMany({
      where: {
        merchantId: payment.merchantId,
        isActive: true,
      },
    });

    availableWallets = sessionWallets(offerableWallets(rawWallets), payment);
  }

  return NextResponse.json({
    id: payment.id,
    status: payment.status,
    chain: payment.chain,
    token: payment.token,
    expectedAmount: payment.expectedAmount,
    receivedAmount: payment.receivedAmount,
    walletAddress: payment.walletAddress,
    xrpDestinationTag: payment.xrpDestinationTag,
    solMemoString: payment.solMemoString,
    txHash: payment.txHash,
    confirmations: payment.confirmations,
    createdAt: payment.createdAt,
    expiresAt: payment.expiresAt,
    isTest: payment.isTest,
    paymentLink: payment.paymentLink,
    availableWallets,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;

  try {
    const { id } = await params;
    const patchSchema = z.object({
      chain: z.string().trim().min(1).max(16).toLowerCase(),
      token: z.string().trim().min(1).max(16).toLowerCase(),
    });

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format", details: parsed.error.format() },
        { status: 400 },
      );
    }
    const { chain, token } = parsed.data;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { paymentLink: { select: { chain: true, token: true } } },
    });

    if (!payment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const tokenRefusal = sessionTokenRefusal(payment, token);
    if (tokenRefusal) {
      return NextResponse.json({ error: tokenRefusal }, { status: 400 });
    }

    // Re-selection (the Back/Edit flow) is allowed only while nothing has been
    // seen on-chain, and only on sessions whose amount is USD-denominated.
    const decision = canReassign(payment, chain, token);
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.error },
        { status: decision.status },
      );
    }
    if (decision.noop) {
      return NextResponse.json({ id: payment.id, chain, token });
    }

    // canReassign already refused every session without a USD base.
    const baseUsd = usdBase(payment)!;
    const metadata = metadataObject(payment.metadata);
    metadata[ORIGINAL_USD_KEY] = baseUsd;

    const assignment = await resolveAssignment({
      merchantId: payment.merchantId,
      chain,
      token,
      amount: { usd: baseUsd },
      context: "hosted_checkout",
      isTest: payment.isTest,
    });
    if (!assignment.ok) {
      return NextResponse.json(
        { error: assignment.error },
        { status: assignment.status, headers: assignment.headers },
      );
    }

    const committed = await commitAssignment(
      id,
      payment.chain,
      assignment.fields,
      metadata,
    );
    if (!committed) return conflict();

    return NextResponse.json({
      id: payment.id,
      chain: assignment.fields.chain,
      token: assignment.fields.token,
      walletAddress: assignment.fields.walletAddress,
      expectedAmount: assignment.fields.expectedAmount,
      xrpDestinationTag: assignment.fields.xrpDestinationTag,
      solMemoString: assignment.fields.solMemoString,
    });
  } catch (error) {
    console.error("Internal PATCH payment error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function conflict() {
  // The session changed between our read and the write — most likely the
  // worker saw a deposit. Re-snapshotting now would hide that deposit.
  return NextResponse.json(
    { error: "This payment can no longer be changed" },
    { status: 409 },
  );
}
