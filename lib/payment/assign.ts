/**
 * Chain assignment for a payment session — the one place a session gets bound
 * to a merchant wallet.
 *
 * Every path that sets chain/token/walletAddress (hosted checkout selection,
 * public API PATCH, both create routes, pinned payment links) must go through
 * here. Each used to do its own subset of the steps, and every omitted step was
 * a money bug:
 *   - no balance snapshot  → the wallet's whole existing balance read as the
 *     buyer's deposit (phantom "overpaid", e.g. 7.7M USDC "received");
 *   - the wallet's static xrpTag instead of a per-session tag → the exclusive
 *     tag scan let concurrent sessions claim each other's deposits;
 *   - no isSupportedPair check → a session no adapter can watch;
 *   - no USD→token conversion → a USD figure charged as a token amount.
 */
import {
  classifySnapshotError,
  recordChainReadFailure,
  snapshotErrorHeaders,
} from "@/lib/chains/errors";
import { getAdapter, isSupportedPair } from "@/lib/chains/registry";
import { prisma } from "@/lib/db";
import { getTokenPriceInUsd } from "@/lib/pricing";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { generateSessionIdentifiers } from "./identifiers";
import { walletRefusal } from "./wallets";

/**
 * What a buyer sees when the merchant is on a billing hold (an overdue
 * platform fee invoice, lib/billing/statements.ts). Shown at checkout step 2.
 */
export const BILLING_HOLD_MESSAGE =
  "This merchant's account is suspended and requires action to be unlocked. Please contact the merchant.";

/** Reserved metadata key: the USD figure a USD-denominated session is priced from. */
export const ORIGINAL_USD_KEY = "originalUsdAmount";

export interface AssignmentFields {
  chain: string;
  token: string;
  walletAddress: string;
  balanceSnapshot: number;
  // When balanceSnapshot was read. Attribution subtracts other sessions'
  // deposits credited after this instant (lib/payment/match.ts).
  snapshotAt: Date;
  // What balanceSnapshot measures; see ChainAdapter.snapshotBasis.
  snapshotBasis: string | null;
  expectedAmount: number;
  xrpDestinationTag: string | null;
  solMemoString: string | null;
}

export type AssignmentFailure = {
  ok: false;
  status: 400 | 403 | 409 | 503;
  error: string;
  headers?: Record<string, string>;
};

export type AssignmentResult =
  | { ok: true; fields: AssignmentFields }
  | AssignmentFailure;

/**
 * A strictly positive, finite amount. `amount || expectedAmount` used to let 0
 * fall through to parseFloat(undefined) = NaN, and negatives went straight in.
 */
export const positiveAmountSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((v) => (typeof v === "number" ? v : Number(v)))
  .refine((n) => Number.isFinite(n) && n > 0, {
    message: "Amount must be a positive number",
  });

/** Crypto amounts are rounded to 6 dp — the precision the checkout displays. */
export function usdToToken(usd: number, priceUsd: number): number {
  return Number((usd / priceUsd).toFixed(6));
}

/**
 * Bind a session to the merchant's wallet for chain/token.
 *
 * Pass `usdAmount` for a USD-denominated session (converted at the current
 * price) or `cryptoAmount` for one the merchant priced in the token itself.
 *
 * Fails closed: an unreadable balance is an error, never a snapshot of 0, since
 * a fabricated 0 turns the wallet's existing balance into the buyer's deposit.
 */
export async function resolveAssignment(opts: {
  merchantId: string;
  chain: string;
  token: string;
  amount: { usd: number } | { crypto: number };
  /** Label recorded on chain read failures, for operators. */
  context: string;
  /**
   * Test sessions are never polled (the worker filters isTest: false) and are
   * advanced via the simulate endpoint, so they skip the chain read.
   */
  isTest?: boolean;
}): Promise<AssignmentResult> {
  const chain = opts.chain.toLowerCase();
  const token = opts.token.toLowerCase();

  // Checked before any lookup: a pair no adapter can watch would never detect
  // a deposit and would silently expire after the buyer had paid.
  const adapter = getAdapter(chain);
  if (!adapter || !isSupportedPair(chain, token)) {
    return {
      ok: false,
      status: 400,
      error: `${token.toUpperCase()} is not supported on ${chain.toUpperCase()}`,
    };
  }

  const wallet = await prisma.wallet.findUnique({
    where: {
      merchantId_chain_token: { merchantId: opts.merchantId, chain, token },
    },
    include: { merchant: { select: { isActive: true, billingHoldAt: true } } },
  });
  // Suspension stops new payments: an open checkout of a suspended merchant
  // can't be bound to a network now (sessions already bound stay watched).
  if (wallet && !wallet.merchant.isActive) {
    return {
      ok: false,
      status: 403,
      error: "This merchant isn't accepting payments right now",
    };
  }
  // An overdue fee invoice pauses new payments the same way, but the merchant
  // keeps their dashboard (they have to sign in to pay it).
  if (wallet?.merchant.billingHoldAt) {
    return { ok: false, status: 403, error: BILLING_HOLD_MESSAGE };
  }
  // Before any chain read: some chains answer a foreign address with a zero
  // balance rather than an error, and a session would open on an address the
  // buyer's funds can't reach (a Solana address saved as an XRP wallet,
  // 2026-10-14). Wallets saved before validation existed are not re-checked
  // anywhere else.
  const refusal = walletRefusal(wallet, chain);
  if (!wallet || refusal) {
    return { ok: false, status: 400, error: refusal ?? "No active wallet" };
  }

  let balanceSnapshot = 0;
  const snapshotAt = new Date();
  if (!opts.isTest) {
    try {
      balanceSnapshot = await adapter.getBalanceSnapshot(wallet.address, token);
    } catch (e: unknown) {
      console.warn(`Failed to get balance snapshot for ${chain}/${token}:`, e);
      const classified = classifySnapshotError(e);
      // 503 means the chain was unreachable — ours to fix, so operators need
      // the cause. 400 is a bad address the merchant has to correct.
      if (classified.status === 503) {
        recordChainReadFailure({
          chain,
          token,
          context: opts.context,
          error: e,
        });
      }
      return {
        ok: false,
        status: classified.status,
        error: classified.error,
        headers: snapshotErrorHeaders(classified),
      };
    }
  }
  if (!Number.isFinite(balanceSnapshot) || balanceSnapshot < 0) {
    return {
      ok: false,
      status: 503,
      error: "Failed to read the wallet balance. Please try again shortly.",
      headers: { "Retry-After": "15" },
    };
  }

  let expectedAmount: number;
  if ("usd" in opts.amount) {
    let price: number;
    try {
      price = await getTokenPriceInUsd(token);
    } catch (e) {
      console.warn(`Failed to fetch price for ${token}:`, e);
      return {
        ok: false,
        status: 503,
        error: "Failed to fetch current exchange rate for this token",
        headers: { "Retry-After": "15" },
      };
    }
    expectedAmount = usdToToken(opts.amount.usd, price);
  } else {
    expectedAmount = opts.amount.crypto;
  }
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return {
      ok: false,
      status: 400,
      error: "Amount is too small to be paid in this token",
    };
  }

  return {
    ok: true,
    fields: {
      chain,
      token,
      walletAddress: wallet.address,
      balanceSnapshot,
      snapshotAt,
      snapshotBasis: adapter.snapshotBasis ?? null,
      expectedAmount,
      ...generateSessionIdentifiers(chain),
    },
  };
}

/**
 * Why a payment link can't be created with this pin, or null. A link pays only
 * into the merchant's saved wallet through resolveAssignment, so it never
 * takes an address of its own (`walletAddress` used to be stored unchecked),
 * and a pinned pair must already have a wallet checkout would accept: one that
 * doesn't silently fell back to buyer selection on every visit.
 */
export async function refuseLinkPin(opts: {
  merchantId: string;
  chain: string | null;
  token: string | null;
  walletAddress?: string | null;
}): Promise<string | null> {
  if (opts.walletAddress) {
    return "walletAddress is not accepted: payment links pay into your saved wallet for the chosen network";
  }
  if (!opts.chain && !opts.token) return null;
  if (!opts.chain || !opts.token || !isSupportedPair(opts.chain, opts.token)) {
    return "chain and token must be given together and be a supported pair";
  }
  const wallet = await prisma.wallet.findUnique({
    where: {
      merchantId_chain_token: {
        merchantId: opts.merchantId,
        chain: opts.chain,
        token: opts.token,
      },
    },
  });
  return walletRefusal(wallet, opts.chain);
}

/** The subset of a Payment row the re-assignment guard reads. */
export interface AssignableSession {
  status: string;
  chain: string | null;
  token: string | null;
  receivedAmount: number | null;
  firstDetectedAt: Date | null;
  txHash: string | null;
  expiresAt: Date;
  expectedAmount: number;
  metadata: Prisma.JsonValue | null;
  paymentLink?: { chain: string | null; token: string | null } | null;
}

export function metadataObject(
  metadata: Prisma.JsonValue | null | undefined,
): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

/**
 * The USD base a session is (re)priced from, or null when the session's
 * amount is denominated in its token.
 *
 * Only a session that has never had a chain is USD-denominated by
 * construction: nothing has converted its expectedAmount yet, so falling back
 * to it is safe. A session with a chain and no recorded USD base was priced in
 * the token by the merchant — reading its expectedAmount as USD is how a 0.5
 * ETH session got repriced to ~0.00017 ETH.
 */
export function usdBase(session: AssignableSession): number | null {
  const recorded = Number(metadataObject(session.metadata)[ORIGINAL_USD_KEY]);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  return session.chain ? null : session.expectedAmount;
}

export type ReassignDecision =
  | { ok: true; noop: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Whether the buyer may (re)select chain/token for this session.
 *
 * Re-selection replaces the wallet, snapshot and identifiers, so it is only
 * safe while nothing has been seen on-chain: re-snapshotting a session whose
 * deposit already landed folds that deposit into the baseline and hides it.
 */
export function canReassign(
  session: AssignableSession,
  chain: string,
  token: string,
  now: Date = new Date(),
): ReassignDecision {
  const sameChain = session.chain?.toLowerCase() === chain.toLowerCase();
  const sameToken = session.token?.toLowerCase() === token.toLowerCase();

  if (
    session.status !== "pending" ||
    session.receivedAmount !== null ||
    session.firstDetectedAt !== null ||
    session.txHash !== null ||
    session.expiresAt.getTime() <= now.getTime()
  ) {
    return {
      ok: false,
      status: 409,
      error: "This payment can no longer be changed",
    };
  }

  if (session.chain) {
    if (sameChain && sameToken) return { ok: true, noop: true };

    // A chain the merchant fixed — directly, or by pinning it on the payment
    // link — is not the buyer's to change. Crypto-priced sessions also have no
    // USD base to reprice from.
    const pinnedByLink = !!(
      session.paymentLink?.chain && session.paymentLink?.token
    );
    if (pinnedByLink || usdBase(session) === null) {
      return {
        ok: false,
        status: 409,
        error: "The network for this payment was set by the merchant",
      };
    }
  }

  return { ok: true, noop: false };
}

/**
 * Atomically write an assignment, re-checking the guard in the WHERE clause so
 * a deposit detected between our read and this write (the worker stamps
 * firstDetectedAt/receivedAmount) makes the write a no-op instead of a
 * re-snapshot. Returns false when the session was no longer assignable.
 */
export async function commitAssignment(
  id: string,
  expectedChain: string | null,
  fields: AssignmentFields,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const { count } = await prisma.payment.updateMany({
    where: {
      id,
      status: "pending",
      receivedAmount: null,
      firstDetectedAt: null,
      txHash: null,
      expiresAt: { gt: new Date() },
      // Optimistic check on what the guard saw, so two racing selections
      // cannot both believe they started from an unassigned session.
      chain: expectedChain,
    },
    data: { ...fields, metadata: metadata as Prisma.InputJsonValue },
  });
  return count === 1;
}
