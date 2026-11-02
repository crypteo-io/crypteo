import type { Payment } from "@prisma/client";
import {
  balanceDelta,
  classifyAmount,
  confirmationsFromAge,
  PAYMENT_TOLERANCE,
  requiredConfirmations,
} from "../lib/chains/config";
import type { ReadCache } from "../lib/chains/interface";
import { getAdapter } from "../lib/chains/registry";
import { prisma } from "../lib/db";
import { sendAdminAlert } from "../lib/admin-alerts";
import {
  creditedToOthersSince,
  findBestMatchingSession,
  loadWalletTags,
} from "../lib/payment/match";
import { triggerNotifications } from "../lib/payment/notify";
import { logOrphanTransaction } from "../lib/payment/orphan";

// Track consecutive failures per payment to alert on persistent issues
const failureCount = new Map<string, number>();
const FAILURE_ALERT_THRESHOLD = 3;

// The scheduler joins the merchant's configured underpaid threshold onto each
// pollable row so classification respects it without a per-poll extra query.
type PollablePayment = Payment & {
  merchant?: { underpaidThreshold: number } | null;
};

/** Prisma's unique-constraint violation (here: Payment.txHash). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Write a poll's outcome only if the row still holds what this poll read
 * (status and credited amount). Nothing else serialises writers: a second
 * worker, a merchant marking the payment paid, or an expiry cron can move the
 * row while the chain read is in flight, and a blind update overwrote their
 * `confirmed` with our `underpaid` and fired notifications twice. Returns the
 * written row, or null when the row moved (their write wins).
 */
async function writeIfUnchanged(
  payment: Payment,
  data: Record<string, unknown>,
): Promise<Payment | null> {
  const where = {
    id: payment.id,
    status: payment.status,
    receivedAmount: payment.receivedAmount,
  };
  let count: number;
  try {
    ({ count } = await prisma.payment.updateMany({ where, data }));
  } catch (err) {
    // Another row took this txHash in between: record the outcome without
    // the hash rather than failing the poll over an explorer link.
    if (!isUniqueViolation(err) || !("txHash" in data)) throw err;
    const { txHash: _dropped, ...rest } = data;
    void _dropped;
    ({ count } = await prisma.payment.updateMany({ where, data: rest }));
  }
  if (count !== 1) return null;
  // The guarded write landing is what proves it was ours; the re-read only
  // gives notifications the row as stored.
  return (
    (await prisma.payment.findUnique({ where: { id: payment.id } })) ??
    ({ ...payment, ...data } as Payment)
  );
}

export async function pollPayment(
  payment: PollablePayment,
  reads?: ReadCache,
) {
  if (!payment.chain || !payment.walletAddress || !payment.token) return;

  const adapter = getAdapter(payment.chain);
  if (!adapter) return;

  const confirmedFrom =
    payment.merchant?.underpaidThreshold ?? PAYMENT_TOLERANCE.confirmed_from;

  try {
    // Only XRP/Solana sessions carry tags; their adapters use these to keep
    // other sessions' tagged deposits out of an untagged fallback.
    const walletTags =
      payment.chain === "xrp" || payment.chain === "sol"
        ? (await loadWalletTags(payment))
            .filter((t) => t.id !== payment.id)
            .map((t) => t.tag)
        : undefined;
    const result = await adapter.checkPayment({
      address: payment.walletAddress,
      expectedAmount: payment.expectedAmount,
      token: payment.token,
      balanceSnapshot: payment.balanceSnapshot,
      createdAt: payment.createdAt,
      xrpDestinationTag: payment.xrpDestinationTag || undefined,
      solMemoString: payment.solMemoString || undefined,
      existingTxHash: payment.txHash || undefined,
      creditedAmount: payment.receivedAmount ?? undefined,
      firstDetectedAt: payment.firstDetectedAt ?? undefined,
      confirmedFrom,
      currentStatus: payment.status,
      snapshotBasis: payment.snapshotBasis,
      walletTags,
      reads,
    });

    const now = new Date();
    const ageMinutes = (now.getTime() - payment.createdAt.getTime()) / 60000;

    // Determine next poll interval based on phase
    const { nextPollAt, pollInterval, pollPhase } = getPollSchedule(ageMinutes);

    if (!result.detected) {
      // A confirming session whose deposit we can no longer see on-chain: the
      // merchant self-custodies and has swept the wallet, so the balance diff
      // is gone. The money did arrive — settle it on elapsed time rather than
      // leaving it in "confirming" until the 24h timeout sweeps it. Null until
      // the deposit has aged past the chain's confirmation requirement.
      const settledStatus = settleUnseenConfirming(payment, now, confirmedFrom);

      const schedule = {
        nextPollAt,
        pollInterval,
        pollPhase,
        lastPolledAt: now,
      };
      if (!settledStatus) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: schedule,
        });
      } else {
        const updated = await writeIfUnchanged(payment, {
          status: settledStatus,
          ...schedule,
        });
        if (updated) {
          console.log(
            `[${now.toISOString()}] Payment ${payment.id} status: ${payment.status} → ${settledStatus} (settled on age; deposit no longer visible on-chain)`,
          );
          await triggerNotifications(updated);
        }
      }

      // Clear failure counter on successful poll
      failureCount.delete(payment.id);
      return;
    }

    // Payment detected — check tx hash deduplication
    if (result.txHash) {
      const existing = await prisma.payment.findUnique({
        where: { txHash: result.txHash },
      });
      if (existing && existing.id !== payment.id) {
        // TX already credited to another payment — skip
        console.warn(
          `[${now.toISOString()}] TX hash ${result.txHash} already used by payment ${existing.id}`,
        );
        await prisma.payment.update({
          where: { id: payment.id },
          data: { nextPollAt, pollInterval, pollPhase, lastPolledAt: now },
        });
        failureCount.delete(payment.id);
        return;
      }
    }

    // ── Attribution ──
    // Exclusive detections (XRP tag / Solana memo) belong to this session
    // alone; balance-diff detections (EVM/BTC and the no-tag fallbacks) compete
    // across every session sharing this wallet+chain+token.
    let attributedAmount = result.receivedAmount || 0;
    let finalStatus: string = result.status || "confirming";
    let logDelta = 0;

    if (!result.exclusive) {
      // Attribute against the ABSOLUTE observed balance so the winner is the
      // same regardless of which session polled. Reconstruct it from this
      // session's snapshot if the adapter didn't report it.
      const currentBalance =
        result.currentBalance ?? attributedAmount + payment.balanceSnapshot;

      const match = await findBestMatchingSession(
        payment.walletAddress,
        payment.chain,
        payment.token,
        currentBalance,
        confirmedFrom,
        undefined,
        payment.snapshotBasis ?? null,
        result.reserved ?? [],
      );

      if (!match) {
        // No matching session — log as orphan for manual review. When the
        // adapter couldn't resolve a real tx hash (e.g. an ETH deposit that
        // aged out of the recent-block scan window), fall back to a
        // deterministic synthetic key so the deposit is still recorded exactly
        // once instead of being silently dropped. The synthetic key dedupes
        // repeated polls of the same unattributed balance and can't collide
        // with a real hash.
        //
        // Without a hash, the diff may be money already credited to another
        // session (an hourly-watched expired session sees every later
        // deposit): only the remainder is unaccounted for. A real hash needs
        // no netting — one credited elsewhere was skipped by the dedupe above.
        const unaccounted = result.txHash
          ? attributedAmount
          : balanceDelta(attributedAmount, await creditedToOthersSince(payment));
        if (unaccounted > 0) {
          const orphanTxHash =
            result.txHash ||
            `synthetic:${payment.chain}:${payment.walletAddress}:${unaccounted}`;
          await logOrphanTransaction({
            txHash: orphanTxHash,
            walletAddress: payment.walletAddress,
            chain: payment.chain,
            token: payment.token,
            receivedAmount: unaccounted,
          });
        }
        // Still advance this session's poll schedule
        await prisma.payment.update({
          where: { id: payment.id },
          data: { nextPollAt, pollInterval, pollPhase, lastPolledAt: now },
        });
        failureCount.delete(payment.id);
        return;
      }

      // Two sessions match this deposit equally well: amounts can't say whose
      // it is. Credit nobody and raise it once (keyed on the balance every
      // poller sees) — "newest wins" here marked an unpaid session paid while
      // the real payer expired.
      if (match.tie) {
        await logOrphanTransaction({
          txHash: `review:tie:${payment.chain}:${payment.token}:${payment.walletAddress}:${currentBalance}`,
          walletAddress: payment.walletAddress,
          chain: payment.chain,
          token: payment.token,
          receivedAmount: match.receivedAmount,
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { nextPollAt, pollInterval, pollPhase, lastPolledAt: now },
        });
        failureCount.delete(payment.id);
        return;
      }

      // If the best match is a DIFFERENT session, skip — let that session's
      // poll cycle handle it. This prevents the wrong session from claiming.
      if (match.session.id !== payment.id) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { nextPollAt, pollInterval, pollPhase, lastPolledAt: now },
        });
        failureCount.delete(payment.id);
        return;
      }

      // This session IS the best match — attribute this candidate's own share.
      attributedAmount = match.receivedAmount;
      logDelta = match.delta;

      // If confirmations are sufficient (adapter returned a terminal status),
      // use the matcher's amount-classification.
      if (
        finalStatus === "confirmed" ||
        finalStatus === "overpaid" ||
        finalStatus === "underpaid"
      ) {
        finalStatus = match.status;
      }
    }

    // Handle expired sessions that received payment within grace period
    if (payment.status === "expired" && result.detected) {
      finalStatus = "expired_received";
    }

    const updated = await writeIfUnchanged(payment, {
      status: finalStatus,
      // Keep a hash already recorded for this session: a poll whose hash
      // lookup failed (an endpoint hiccup) reported none and erased it.
      txHash: payment.txHash ?? result.txHash ?? null,
      receivedAmount: attributedAmount,
      confirmations: result.confirmations,
      senderAddress: result.fromAddress || null,
      // Stamped once, on the first poll that saw money. Anchors the
      // age-derived confirmation count and the stuck-in-confirming timeout;
      // both would be defeated by updatedAt, which every poll refreshes.
      firstDetectedAt: payment.firstDetectedAt ?? now,
      lastPolledAt: now,
      nextPollAt,
      pollInterval,
      pollPhase,
    });

    if (!updated) {
      // The row moved underneath us (mark-paid, expiry cron, another worker).
      // Their write wins; the next poll starts from it.
      console.warn(
        `[${now.toISOString()}] Payment ${payment.id} changed during poll (was ${payment.status}); discarding this poll's outcome`,
      );
      failureCount.delete(payment.id);
      return;
    }

    // Trigger emails and webhooks if status changed
    if (finalStatus !== payment.status) {
      console.log(
        `[${now.toISOString()}] Payment ${payment.id} status: ${payment.status} → ${finalStatus} (delta: ${logDelta.toFixed(6)})`,
      );
      await triggerNotifications(updated);
    }

    // Clear failure counter on success
    failureCount.delete(payment.id);
  } catch (err) {
    const count = (failureCount.get(payment.id) || 0) + 1;
    failureCount.set(payment.id, count);

    // Back off before retrying. Without this the row keeps its past-due
    // nextPollAt and is re-polled every 10s cycle, so a refusing endpoint gets
    // hammered by every failing session at once.
    try {
      const backoffSec = Math.min(15 * 2 ** (count - 1), 300);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          nextPollAt: new Date(Date.now() + backoffSec * 1000),
          lastPolledAt: new Date(),
        },
      });
    } catch (writeErr) {
      console.error(
        `[${new Date().toISOString()}] Backoff write failed for ${payment.id}:`,
        writeErr,
      );
    }

    console.error(
      `[${new Date().toISOString()}] Poll error for payment ${payment.id} (attempt ${count}):`,
      err,
    );

    // Alert admins on repeated failures with detailed payment context
    if (count === FAILURE_ALERT_THRESHOLD) {
      {
        const { pollTrackingFailureHtml } = await import(
          "../lib/emails/templates"
        );
        const error = err instanceof Error ? err : new Error(String(err));
        const { adminUrl } = await import("../lib/admin-host");
        const dashboardUrl = adminUrl(`/merchants/${payment.merchantId}`);
        await sendAdminAlert(
          `🔴 Payment Tracking Failure: ${payment.id}`,
          pollTrackingFailureHtml({
            paymentId: payment.id,
            chain: payment.chain,
            token: payment.token,
            walletAddress: payment.walletAddress,
            expectedAmount: payment.expectedAmount,
            xrpDestinationTag: payment.xrpDestinationTag || null,
            failureCount: count,
            errorMessage: error.message,
            errorStack: error.stack,
            timestamp: new Date().toISOString(),
            dashboardUrl,
          }),
        ).catch(console.error);
      }
    }
  }
}

/**
 * Final status for a "confirming" session whose deposit is no longer visible
 * on-chain, or null if it isn't yet eligible to be settled.
 *
 * Detection is balance-diff based, and the merchant owns the wallet — once they
 * sweep it, the diff disappears and every later poll reports "not detected".
 * The deposit was real and was credited; without this the session would sit in
 * "confirming" until the 24h timeout, which is how confirmed payments ended up
 * looking unpaid for months.
 *
 * Requires a credited amount (so we never invent a payment), an anchor, and
 * enough elapsed time to satisfy the chain's confirmation requirement.
 */
export function settleUnseenConfirming(
  payment: Payment,
  now: Date = new Date(),
  confirmedFrom?: number,
): string | null {
  if (payment.status !== "confirming") return null;
  if (!payment.receivedAmount || payment.receivedAmount <= 0) return null;
  if (!payment.chain || !payment.token) return null;

  const anchor = payment.firstDetectedAt ?? payment.createdAt;
  const required = requiredConfirmations(payment.chain, payment.token);
  if (confirmationsFromAge(payment.chain, anchor, now) < required) return null;

  return classifyAmount(
    payment.receivedAmount,
    payment.expectedAmount,
    confirmedFrom,
  );
}

/**
 * Adaptive polling schedule: the older a session gets, the less often we poll.
 * Pure function of session age (and an injectable `now` for testing).
 */
export function getPollSchedule(ageMinutes: number, now: Date = new Date()) {
  let interval: number;
  let phase: string;

  if (ageMinutes < 3) {
    interval = 15;
    phase = "phase1";
  } else if (ageMinutes < 10) {
    interval = 30;
    phase = "phase2";
  } else if (ageMinutes < 60) {
    interval = 180;
    phase = "phase3";
  } else {
    interval = 3600;
    phase = "phase4";
  }

  return {
    nextPollAt: new Date(now.getTime() + interval * 1000),
    pollInterval: interval,
    pollPhase: phase,
  };
}
