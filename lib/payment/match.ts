import type { Payment } from "@prisma/client";
import type { TaggedTransfer } from "../chains/interface";
import { prisma } from "../db";
import {
  AmountStatus,
  balanceDelta,
  classifyAmount,
  PAYMENT_TOLERANCE,
} from "../chains/config";

import { GRACE_PERIOD_MS, TOPUP_WINDOW_MS } from "./windows";

export { GRACE_PERIOD_MS, TOPUP_WINDOW_MS };

interface AttributionResult {
  session: Payment;
  delta: number;
  status: AmountStatus;
  receivedAmount: number;
  /**
   * Another candidate matches this deposit exactly as well. Amounts can't say
   * whose it is, so nobody is credited automatically: the old "newest wins"
   * tiebreak marked an unpaid session paid while the real payer expired.
   * Equal amounts on one wallet are rare (a merchant's surge of same-price
   * orders), so a person deciding the rare tie costs little.
   */
  tie?: boolean;
}

/**
 * Deposits in `session`'s diff that carry ANOTHER session's tag/memo: they
 * landed after its snapshot and belong to whoever holds that identifier.
 * Without this, an untagged session's figure included a neighbour's tagged
 * payment, tied with the neighbour, and the newest won it.
 */
export function reservedForOthers(
  session: Pick<Payment, "snapshotAt" | "createdAt" | "xrpDestinationTag" | "solMemoString">,
  reserved: readonly TaggedTransfer[],
): number {
  const own = session.xrpDestinationTag ?? session.solMemoString ?? null;
  const anchor = (session.snapshotAt ?? session.createdAt).getTime();
  return reserved
    .filter((r) => r.tag !== own && r.at.getTime() > anchor)
    .reduce((sum, r) => sum + r.amount, 0);
}

/**
 * Find the best matching payment session for a balance-diff deposit.
 *
 * `currentBalance` is the ABSOLUTE on-chain balance observed this poll — the
 * same value no matter which session polled. Each candidate's own received
 * amount is derived as `currentBalance - candidate.balanceSnapshot`, so the
 * winner is deterministic across sessions (a session polling its own snapshot
 * delta would otherwise pick a poller-dependent winner, and two sessions could
 * each defer to the other forever, stranding the deposit).
 *
 * Scoring logic:
 * 1. Amount proximity — lowest ABS(expectedAmount - received_i) wins
 * 2. An exact tie is flagged (`tie`), never broken by recency
 * 3. Validate — ≥99% match = confirmed/overpaid, <99% = underpaid
 *
 * Returns null if no candidate plausibly received this deposit (orphan).
 */
export async function findBestMatchingSession(
  walletAddress: string,
  chain: string,
  token: string,
  currentBalance: number,
  confirmedFrom: number = PAYMENT_TOLERANCE.confirmed_from,
  blockTime?: Date,
  // Only sessions whose snapshot measures the same thing as `currentBalance`
  // are comparable; a legacy snapshot against a new-basis reading (or the
  // reverse) yields a meaningless delta. Null = legacy basis.
  snapshotBasis: string | null = null,
  // Deposits carrying a session's tag/memo: never another session's money.
  reserved: readonly TaggedTransfer[] = [],
): Promise<AttributionResult | null> {
  const graceThreshold = new Date(
    (blockTime?.getTime() || Date.now()) - GRACE_PERIOD_MS,
  );

  // Fetch all candidate sessions:
  // - pending sessions that haven't expired
  // - recently expired sessions (within grace period) as fallback
  const candidates = await prisma.payment.findMany({
    where: {
      walletAddress,
      chain,
      token,
      status: { in: ["pending", "confirming"] },
      expiresAt: { gt: graceThreshold },
      isTest: false,
      snapshotBasis,
    },
    orderBy: { createdAt: "desc" },
  });

  // Also include recently-expired sessions (grace period)
  const graceExpired = await prisma.payment.findMany({
    where: {
      walletAddress,
      chain,
      token,
      status: "expired",
      expiresAt: { gt: graceThreshold, lte: new Date() },
      isTest: false,
      snapshotBasis,
      txHash: null, // Only consider sessions that haven't been attributed yet
    },
    orderBy: { createdAt: "desc" },
  });

  // And underpaid sessions still inside their top-up window, so a follow-up
  // deposit that brings the total over the threshold completes the invoice.
  const underpaid = await prisma.payment.findMany({
    where: {
      walletAddress,
      chain,
      token,
      status: "underpaid",
      // Keyed off the immutable expiresAt, not updatedAt — every poll refreshes
      // updatedAt, which would keep the window open forever.
      expiresAt: { gt: new Date(Date.now() - TOPUP_WINDOW_MS) },
      isTest: false,
      snapshotBasis,
    },
    orderBy: { createdAt: "desc" },
  });

  const allCandidates = [...candidates, ...graceExpired, ...underpaid];

  // Derive each candidate's own received amount from the absolute balance and
  // keep only those that plausibly received this deposit (positive delta). A
  // candidate whose snapshot already exceeds the current balance can't be the
  // recipient.
  const scored = allCandidates
    .map((session) => {
      // balanceDelta for the subtraction too: it discards float noise at the
      // operands' magnitude, so 0.8 − (0.7 + 0.1) is 0, not 1e-16.
      const received = balanceDelta(
        balanceDelta(currentBalance, session.balanceSnapshot),
        reservedForOthers(session, reserved),
      );
      return {
        session,
        received,
        delta: Math.abs(session.expectedAmount - received),
      };
    })
    .filter((c) => c.received > 0);

  if (scored.length === 0) return null;

  // Sort: lowest delta first, then newest first (createdAt DESC)
  scored.sort((a, b) => {
    if (a.delta !== b.delta) return a.delta - b.delta;
    return (
      new Date(b.session.createdAt).getTime() -
      new Date(a.session.createdAt).getTime()
    );
  });

  const winner = scored[0];
  const runnerUp = scored[1];
  const tie =
    !!runnerUp &&
    Math.abs(runnerUp.delta - winner.delta) <=
      1e-12 * Math.max(1, winner.session.expectedAmount);

  // Determine outcome using the shared classifier (single source of truth).
  const status = classifyAmount(
    winner.received,
    winner.session.expectedAmount,
    confirmedFrom,
  );

  return {
    session: winner.session,
    delta: winner.delta,
    status,
    receivedAmount: winner.received,
    tie,
  };
}

/**
 * Funds the worker credited to OTHER sessions on this wallet+chain+token after
 * `session`'s snapshot: the part of its balance diff that is already somebody's.
 *
 * Only for deciding whether an unattributed diff is new money, never for
 * crediting. The hourly expired watch re-reads sessions long past grace, whose
 * diff still contains every later deposit; a deposit already credited to the
 * session it paid (but whose hash the native scan could no longer resolve) was
 * raised as an "unmatched transaction" (2026-10-14, 0.002067 ETH).
 * Hand-marked payments are excluded: they carry no on-chain detection.
 */
export async function creditedToOthersSince(
  session: Pick<
    Payment,
    "id" | "walletAddress" | "chain" | "token" | "snapshotAt" | "createdAt" | "snapshotBasis"
  >,
): Promise<number> {
  const { walletAddress, chain, token } = session;
  if (!walletAddress || !chain || !token) return 0;
  const rows = await prisma.payment.findMany({
    where: {
      id: { not: session.id },
      walletAddress,
      chain,
      token,
      isTest: false,
      snapshotBasis: session.snapshotBasis ?? null,
      receivedAmount: { gt: 0 },
      firstDetectedAt: { gt: session.snapshotAt ?? session.createdAt },
    },
    select: { receivedAmount: true },
    take: 1000,
  });
  return (rows ?? []).reduce((sum, r) => sum + (r.receivedAmount ?? 0), 0);
}

const WALLET_TAG_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tags/memos of the wallet's sessions from the last day, whatever their
 * status: a late deposit tagged for an expired session is still that
 * session's money, never another session's fallback.
 */
export async function loadWalletTags(
  payment: Pick<Payment, "walletAddress" | "chain" | "token">,
): Promise<{ tag: string; id: string }[]> {
  const { walletAddress, chain, token } = payment;
  if (!walletAddress || !chain || !token) return [];
  const rows = await prisma.payment.findMany({
    where: {
      walletAddress,
      chain,
      token,
      isTest: false,
      createdAt: { gt: new Date(Date.now() - WALLET_TAG_WINDOW_MS) },
      OR: [{ xrpDestinationTag: { not: null } }, { solMemoString: { not: null } }],
    },
    select: { id: true, xrpDestinationTag: true, solMemoString: true },
    take: 1000,
  });
  return (rows ?? []).flatMap((r) => {
    const tag = r.xrpDestinationTag ?? r.solMemoString;
    return tag ? [{ tag, id: r.id }] : [];
  });
}
