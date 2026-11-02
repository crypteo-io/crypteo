import type { Payment, Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { triggerNotifications } from "../lib/payment/notify";

// Rows per cron tick. Bounded so one tick after an outage can't hold the
// worker for minutes; the next tick picks up the rest.
const EXPIRY_BATCH = 200;

// A confirming session that hasn't settled in this long is timed out.
export const CONFIRMING_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Move each selected row from `from` to `to`, one compare-and-set at a time,
 * and notify for exactly the rows this call moved.
 *
 * A bulk updateMany can't tell us WHICH rows changed, so it could never fire
 * their webhooks: merchants got no event for an expiry, nor for a confirming
 * session timing out with funds on it (expired_received — money arrived and
 * someone needs to look). The per-row status guard means a row a poll or a
 * merchant moved in the meantime is left alone and not notified twice.
 */
async function transition(
  where: Prisma.PaymentWhereInput,
  from: string,
  to: string,
): Promise<Payment[]> {
  const rows = await prisma.payment.findMany({
    where: { ...where, status: from },
    select: { id: true },
    take: EXPIRY_BATCH,
  });

  const moved: Payment[] = [];
  for (const { id } of rows) {
    const { count } = await prisma.payment.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    if (count !== 1) continue;

    const updated = await prisma.payment.findUnique({ where: { id } });
    if (!updated) continue;
    moved.push(updated);
    try {
      await triggerNotifications(updated);
    } catch (err) {
      // The status change stands; a failed notification must not stop the
      // rest of the batch. Webhook failures are retried by their own cron.
      console.error(
        `[${new Date().toISOString()}] Notification failed for expired payment ${id}:`,
        err,
      );
    }
  }
  return moved;
}

/** `pending` sessions past expiresAt → `expired`. */
export async function expireStalePending(now: Date = new Date()) {
  return transition(
    { expiresAt: { lte: now }, isTest: false },
    "pending",
    "expired",
  );
}

/**
 * `confirming` sessions stuck past the timeout. Keyed off firstDetectedAt
 * (when the deposit was first seen), NOT updatedAt: a confirming session is
 * polled continuously and every poll writes the row, so updatedAt is never
 * more than one poll interval old. Rows detected before firstDetectedAt
 * existed fall back to createdAt, which is likewise immutable.
 *
 * A confirming session by definition saw money arrive. Timing it out as a
 * plain "expired" would erase that, so anything with a credited amount lands
 * in expired_received — "funds arrived, session did not complete".
 */
export async function timeoutStaleConfirming(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - CONFIRMING_TIMEOUT_MS);
  const stale: Prisma.PaymentWhereInput = {
    OR: [
      { firstDetectedAt: { lte: cutoff } },
      { firstDetectedAt: null, createdAt: { lte: cutoff } },
    ],
  };

  const received = await transition(
    { isTest: false, AND: [stale, { receivedAmount: { gt: 0 } }] },
    "confirming",
    "expired_received",
  );
  // Explicitly unfunded — not "whatever is left": a funded row the batch above
  // didn't reach must not be expired as if nothing arrived.
  const expired = await transition(
    {
      isTest: false,
      AND: [
        stale,
        { OR: [{ receivedAmount: null }, { receivedAmount: { lte: 0 } }] },
      ],
    },
    "confirming",
    "expired",
  );
  return { received, expired };
}
