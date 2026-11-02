import { prisma } from "../db";
import { ORIGINAL_USD_KEY } from "../payment/assign";
import { offerableWallets, FEE_PAYMENT_TOKENS } from "../payment/wallets";
import { getPlatformSettings } from "./settings";

const CHECKOUT_TTL_MS = 60 * 60 * 1000;
/** An open fee checkout with less time than this left is replaced, not reused. */
const REUSE_MIN_REMAINING_MS = 15 * 60 * 1000;
/** A fee checkout in these states already holds (or is about to hold) funds. */
const IN_FLIGHT_STATUSES = ["confirming", "underpaid"];

export type FeeCheckoutResult =
  | { ok: true; paymentId: string }
  | { ok: false; status: 404 | 409 | 503; error: string };

/**
 * The hosted checkout that pays a merchant's open fee statement: a session on
 * the platform billing account, priced in USD, payable in USDT/USDC only
 * (lib/payment/wallets.ts sessionWallets). Reuses the statement's open session
 * while it has time left, and never opens a second one while funds are in
 * flight on another.
 */
export async function openFeeCheckout(
  merchantId: string,
  statementId: string,
  now: Date = new Date(),
): Promise<FeeCheckoutResult> {
  const statement = await prisma.feeStatement.findFirst({
    where: { id: statementId, merchantId },
    select: { id: true, status: true, amountDueUsd: true, periodStart: true },
  });
  if (!statement) return { ok: false, status: 404, error: "Invoice not found" };
  if (statement.status !== "open") {
    return {
      ok: false,
      status: 409,
      error: "This invoice is not open for payment",
    };
  }

  const { billingMerchantId: billingAccountId } = await getPlatformSettings({ fresh: true });
  const billing = billingAccountId
    ? await prisma.merchant.findUnique({
        where: { id: billingAccountId },
        select: {
          isActive: true,
          wallets: {
            where: { isActive: true, token: { in: [...FEE_PAYMENT_TOKENS] } },
            select: { chain: true, token: true, address: true },
          },
        },
      })
    : null;
  if (!billingAccountId || !billing?.isActive || offerableWallets(billing.wallets).length === 0) {
    console.error("[billing] fee checkout requested but no billing account wallet is set up");
    return {
      ok: false,
      status: 503,
      error: "Online fee payment isn't available right now. Please contact support.",
    };
  }

  // One statement, one live checkout: a double click must not open two
  // sessions a merchant could both pay. Serialised per statement.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${statement.id}))`;
    const existing = await tx.payment.findFirst({
      where: {
        feeForStatementId: statement.id,
        merchantId: billingAccountId,
        OR: [
          { status: { in: IN_FLIGHT_STATUSES } },
          // A network was picked: the merchant may be sending to it right now.
          { status: "pending", chain: { not: null }, expiresAt: { gt: now } },
          {
            status: "pending",
            expiresAt: { gt: new Date(now.getTime() + REUSE_MIN_REMAINING_MS) },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) return { ok: true as const, paymentId: existing.id };

    const payment = await tx.payment.create({
      data: {
        merchantId: billingAccountId,
        expectedAmount: statement.amountDueUsd,
        status: "pending",
        pollInterval: 15,
        pollPhase: "phase1",
        nextPollAt: new Date(now.getTime() + 15_000),
        externalId: `fee:${statement.id}`,
        metadata: {
          [ORIGINAL_USD_KEY]: statement.amountDueUsd,
          feeStatementId: statement.id,
          payerMerchantId: merchantId,
          period: statement.periodStart.toISOString().slice(0, 7),
        },
        feeForStatementId: statement.id,
        expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
      },
      select: { id: true },
    });
    return { ok: true as const, paymentId: payment.id };
  });
}
