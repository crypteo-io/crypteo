import { validateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { isPaidStatus } from "@/lib/payment/status";
import { offerableWallets } from "@/lib/payment/wallets";
import { rateLimit } from "@/lib/rate-limit";
import { AvailableWallet, Payment } from "@/types/payment";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AssignmentFields,
  canReassign,
  commitAssignment,
  metadataObject,
  ORIGINAL_USD_KEY,
  resolveAssignment,
  usdBase,
} from "@/lib/payment/assign";
import { generateSessionIdentifiers } from "@/lib/payment/identifiers";
import { paymentQrValue } from "@/components/checkout/paymentUri";
import { formatAmount } from "@/lib/format";
import { byWalletOrder, slotLabel } from "@/lib/wallet-slots";

// Well-formed placeholder per chain, so a test checkout shows an address of
// the right shape (and a QR that parses) for the network the buyer picked.
// Burn/genesis-style addresses; test sessions are never polled.
const TEST_MOCK_ADDRESSES: Record<string, string> = {
  sol: "11111111111111111111111111111111",
  btc: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  xrp: "rrrrrrrrrrrrrrrrrrrrrhoLvTp",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  doge: "DDogepartyxxxxxxxxxxxxxxxxxxw1dfzr",
};

/** What the buyer still has to send: the shortfall once a partial deposit has landed. */
function dueNow(payment: { status: string; expectedAmount: number; receivedAmount: number | null }): number {
  return payment.status === "underpaid"
    ? Math.max(payment.expectedAmount - (payment.receivedAmount ?? 0), 0)
    : payment.expectedAmount;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await validateApiKey(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { merchant, isTest } = authResult;

  const { id } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { paymentLink: true },
  });

  // A key only sees sessions of its own mode: test keys must never read or
  // act on live sessions (and vice versa).
  if (
    !payment ||
    payment.merchantId !== merchant.id ||
    payment.isTest !== isTest
  ) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  // While the buyer can still pick or change the network, the wallets they
  // can pick from.
  let availableWallets: AvailableWallet[] = [];
  if (!payment.chain || payment.status === "pending") {
    const rawWallets = await prisma.wallet.findMany({
      where: {
        merchantId: payment.merchantId,
        isActive: true,
      },
    });
    availableWallets = byWalletOrder(offerableWallets(rawWallets)).map(
      ({ chain, token, address }) => ({ chain, token, address, ...slotLabel(chain, token) }),
    );
  }

  const amountDue = dueNow(payment);

  return NextResponse.json({
    success: true,
    payment: {
      id: payment.id,
      status: payment.status,
      paid: isPaidStatus(payment.status),
      chain: payment.chain,
      token: payment.token,
      expectedAmount: payment.expectedAmount,
      receivedAmount: payment.receivedAmount,
      txHash: payment.txHash,
      walletAddress: payment.walletAddress,
      xrpDestinationTag: payment.xrpDestinationTag,
      solMemoString: payment.solMemoString,
      amountDue,
      amountDueText: formatAmount(amountDue, payment.token),
      paymentUri: paymentQrValue({
        chain: payment.chain,
        token: payment.token,
        address: payment.walletAddress,
        amount: amountDue,
        solMemo: payment.solMemoString,
      }),
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      externalId: payment.externalId,
      expiresAt: payment.expiresAt,
      isTest: (payment as unknown as Payment).isTest || false,
      paymentLink: (payment as unknown as Payment).paymentLink
        ? {
            title: (payment as unknown as Payment).paymentLink!.title,
            description: (payment as unknown as Payment).paymentLink!
              .description,
          }
        : null,
    },
    availableWallets,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await rateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;
  const authResult = await validateApiKey(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { merchant, isTest } = authResult;

  try {
    const { id } = await params;
    const patchSchema = z.object({
      chain: z.string().min(1),
      token: z.string().min(1),
    });

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid data format", details: parsed.error.format() },
        { status: 400 },
      );
    }
    const { chain, token } = parsed.data;

    const normalizedChain = chain.toLowerCase();
    const normalizedToken = token.toLowerCase();

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { paymentLink: true },
    });

    // Mode isolation: a test key assigning a LIVE session used to bind it to
    // the mock 0x000…000 address (which holds real ETH) with a zero snapshot,
    // and the worker then reported a phantom overpayment.
    if (
      !payment ||
      payment.merchantId !== merchant.id ||
      payment.isTest !== isTest
    ) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const decision = canReassign(payment, normalizedChain, normalizedToken);
    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.error },
        { status: decision.status },
      );
    }

    let updatedPayment = payment;
    if (!decision.noop) {
      // canReassign already refused every session without a USD base.
      const baseUsd = usdBase(payment)!;
      const metadata = metadataObject(payment.metadata);
      metadata[ORIGINAL_USD_KEY] = baseUsd;

      let fields: AssignmentFields;
      if (payment.isTest) {
        // Test sessions are never polled and are advanced via the simulate
        // endpoint, so a mock address is enough — and isTest was matched to
        // the key above, so this can only ever touch a test session.
        const mockAddress =
          TEST_MOCK_ADDRESSES[normalizedChain] ??
          "0x0000000000000000000000000000000000000000";
        fields = {
          chain: normalizedChain,
          token: normalizedToken,
          walletAddress: mockAddress,
          balanceSnapshot: 0,
          snapshotAt: new Date(),
          snapshotBasis: null,
          expectedAmount: payment.expectedAmount,
          ...generateSessionIdentifiers(normalizedChain),
        };
      } else {
        const assignment = await resolveAssignment({
          merchantId: merchant.id,
          chain: normalizedChain,
          token: normalizedToken,
          amount: { usd: baseUsd },
          context: "public_api_assign",
        });
        if (!assignment.ok) {
          return NextResponse.json(
            { error: assignment.error },
            { status: assignment.status, headers: assignment.headers },
          );
        }
        fields = assignment.fields;
      }

      const committed = await commitAssignment(
        id,
        payment.chain,
        fields,
        metadata,
      );
      if (!committed) {
        // Changed between our read and the write — most likely the worker saw
        // a deposit, and re-snapshotting now would hide it.
        return NextResponse.json(
          { error: "This payment can no longer be changed" },
          { status: 409 },
        );
      }
      updatedPayment = { ...payment, ...fields };
    }

    return NextResponse.json({
      success: true,
      payment: {
        id: updatedPayment.id,
        chain: updatedPayment.chain,
        token: updatedPayment.token,
        walletAddress: updatedPayment.walletAddress,
        amount: updatedPayment.expectedAmount,
        // The buyer must attach these for the deposit to be attributed to this
        // session on a shared wallet.
        xrpDestinationTag: updatedPayment.xrpDestinationTag,
        solMemoString: updatedPayment.solMemoString,
        paymentLink: (payment as unknown as Payment).paymentLink
          ? {
              title: (payment as unknown as Payment).paymentLink!.title,
              description: (payment as unknown as Payment).paymentLink!
                .description,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Update payment error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
