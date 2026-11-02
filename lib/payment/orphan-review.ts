import { balanceDelta, classifyAmount } from "../chains/config";
import type { PaymentStatus } from "../chains/interface";
import { GRACE_PERIOD_MS } from "./match";

// Pure: the admin orphan review (app/api/admin/orphans) decides with these.
// Guarded by lib/payment/orphan-review.test.ts.

export type OrphanKind = "transaction" | "unattributed" | "tie";

/**
 * What an orphan row records. The worker writes three shapes of txHash
 * (workers/poll.ts): a real chain hash; `synthetic:` when a deposit was seen
 * by balance diff but no hash could be resolved; `review:tie:` when two
 * sessions matched one deposit equally and nobody was credited.
 */
export function orphanKind(txHash: string): OrphanKind {
  if (txHash.startsWith("review:tie:")) return "tie";
  if (txHash.startsWith("synthetic:")) return "unattributed";
  return "transaction";
}

/** Only a real chain hash may be stored on a payment (Payment.txHash dedupes on it). */
export function isChainTxHash(txHash: string): boolean {
  return orphanKind(txHash) === "transaction";
}

export interface CandidateSession {
  status: string;
  isTest: boolean;
  expiresAt: Date;
  walletAddress: string | null;
  chain: string | null;
  token: string | null;
}

// Statuses a deposit may be credited onto by hand. Every other status is
// either still polled (pending, confirming, underpaid in its top-up window) or
// already settled (confirmed, overpaid).
const CREDITABLE_STATUSES = new Set<string>(["expired", "expired_received"]);

/**
 * Why an orphan can't be credited to this session, or null. A session the
 * worker can still attribute to (open, or expired within the grace period) is
 * refused: attribution measures each session's balance delta independently and
 * doesn't subtract what other sessions were credited, so a hand credit there
 * lets the worker pay the same deposit to a second session.
 */
export function refuseCredit(
  orphan: { walletAddress: string; chain: string; token: string },
  session: CandidateSession,
  nowMs: number,
): string | null {
  if (session.isTest) return "Test session";
  if (
    session.walletAddress !== orphan.walletAddress ||
    session.chain !== orphan.chain ||
    session.token !== orphan.token
  ) {
    return "Different wallet or token";
  }
  if (!CREDITABLE_STATUSES.has(session.status)) {
    return session.status === "pending" ||
      session.status === "confirming" ||
      session.status === "underpaid"
      ? "Still being watched: wait until it expires"
      : `Already ${session.status}`;
  }
  if (session.expiresAt.getTime() > nowMs - GRACE_PERIOD_MS) {
    return "Expired less than 15 minutes ago: the worker may still credit it";
  }
  return null;
}

/**
 * The session's figures once this orphan is credited to it. Funds already on
 * the session (an expired_received partial) are added to, never replaced. A
 * total that still falls short settles as expired_received, not underpaid:
 * the session is over, and underpaid would put it back in the worker's
 * top-up window.
 */
export function planOrphanCredit(
  session: { receivedAmount: number | null; expectedAmount: number },
  orphanAmount: number,
  confirmedFrom?: number,
): { receivedAmount: number; status: PaymentStatus } {
  const receivedAmount = balanceDelta(orphanAmount + (session.receivedAmount ?? 0), 0);
  const classified = classifyAmount(receivedAmount, session.expectedAmount, confirmedFrom);
  return {
    receivedAmount,
    status: classified === "underpaid" ? "expired_received" : classified,
  };
}
