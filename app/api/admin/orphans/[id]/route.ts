import { auditLog, requireAdmin } from "@/lib/admin";
import { CONFIRMATIONS_REQUIRED } from "@/lib/chains/config";
import { prisma } from "@/lib/db";
import { triggerNotifications } from "@/lib/payment/notify";
import { isChainTxHash, planOrphanCredit, refuseCredit } from "@/lib/payment/orphan-review";
import { rateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ID = /^[a-z0-9]{20,40}$/;

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("credit"),
    paymentId: z.string().regex(ID, "Invalid session id"),
    // What the admin was shown and confirmed. A session that has moved since
    // (a late deposit, the expiry cron) would be credited to a different total
    // than the one they agreed to, so it's refused instead.
    seen: z.object({ status: z.string(), receivedAmount: z.number().nullable() }),
  }),
  z.object({
    action: z.literal("dismiss"),
    notes: z.string().trim().min(3, "Say why it's being dismissed").max(500),
  }),
]);

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Thrown inside the transaction to roll it back with a client-facing answer. */
class Conflict extends Error {}

/** The merchant an orphan belongs to: whoever registered the receiving wallet. */
async function walletOwner(orphan: { walletAddress: string; chain: string; token: string }) {
  const wallet = await prisma.wallet.findFirst({
    where: { address: orphan.walletAddress, chain: orphan.chain, token: orphan.token },
    select: { merchantId: true },
  });
  return wallet?.merchantId ?? "unknown";
}

/**
 * Resolve an orphan: credit it to one expired session, or dismiss it with a
 * reason (dust, address poisoning, the merchant's own transfer). Either way the
 * orphan is claimed with a compare-and-set, so two admins can't resolve it twice.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return fail("Invalid orphan id", 400);
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  const action = parsed.data;

  try {
    const orphan = await prisma.orphanTransaction.findUnique({ where: { id } });
    if (!orphan) return fail("Orphan not found", 404);
    if (orphan.resolvedAt) return fail("Already resolved", 409);

    if (action.action === "dismiss") {
      const merchantId = await walletOwner(orphan);
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.orphanTransaction.updateMany({
          where: { id, resolvedAt: null },
          data: { resolvedByAdmin: true, resolvedAt: new Date(), notes: action.notes },
        });
        if (count !== 1) throw new Conflict("Already resolved");
        await auditLog(tx, admin, merchantId, "dismissOrphan", {
          orphanId: id,
          txHash: orphan.txHash,
          notes: action.notes,
        });
      });
      return NextResponse.json({ success: true });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: action.paymentId },
      include: { merchant: { select: { underpaidThreshold: true } } },
    });
    if (!payment) return fail("Session not found", 404);
    if (
      payment.status !== action.seen.status ||
      payment.receivedAmount !== action.seen.receivedAmount
    ) {
      return fail("This session changed since you opened the page. Reload and review it again.", 409);
    }
    const refusal = refuseCredit(orphan, payment, Date.now());
    if (refusal) return fail(refusal, 409);

    const chainHash = isChainTxHash(orphan.txHash) ? orphan.txHash : null;
    if (chainHash) {
      const holder = await prisma.payment.findUnique({
        where: { txHash: chainHash },
        select: { id: true },
      });
      if (holder) return fail(`This transaction is already credited to session ${holder.id}`, 409);
    }

    const plan = planOrphanCredit(payment, orphan.receivedAmount, payment.merchant.underpaidThreshold);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.orphanTransaction.updateMany({
        where: { id, resolvedAt: null },
        data: {
          resolvedByAdmin: true,
          resolvedAt: new Date(),
          resolvedToPaymentId: payment.id,
          notes: `Credited to ${payment.id}`,
        },
      });
      if (claimed.count !== 1) throw new Conflict("Already resolved");

      // Guarded on what was read: the expiry cron or a merchant action may have
      // moved the session since (status writes are compare-and-set).
      const credited = await tx.payment.updateMany({
        where: { id: payment.id, status: payment.status, receivedAmount: payment.receivedAmount },
        data: {
          status: plan.status,
          receivedAmount: plan.receivedAmount,
          // A recorded hash is never replaced (an expired_received partial keeps its own).
          ...(chainHash && !payment.txHash ? { txHash: chainHash } : {}),
          firstDetectedAt: payment.firstDetectedAt ?? orphan.blockTime ?? orphan.createdAt,
          confirmations: Math.max(payment.confirmations, CONFIRMATIONS_REQUIRED[payment.chain!] ?? 1),
        },
      });
      if (credited.count !== 1) {
        throw new Conflict("The session changed while you were reviewing it. Reload and try again.");
      }
      await auditLog(tx, admin, payment.merchantId, "creditOrphan", {
        orphanId: id,
        paymentId: payment.id,
        txHash: orphan.txHash,
        amount: orphan.receivedAmount,
        from: payment.status,
        to: plan.status,
      });
    });

    const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    // Committed already: a webhook or mail failure must not fail the request.
    try {
      await triggerNotifications(updated);
    } catch (error) {
      console.error(`[admin/orphans] notifications failed for ${payment.id}:`, error);
    }
    return NextResponse.json({ success: true, status: plan.status, receivedAmount: plan.receivedAmount });
  } catch (error) {
    if (error instanceof Conflict) return fail(error.message, 409);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("This transaction is already credited to another session", 409);
    }
    console.error("[admin/orphans/:id]", error);
    return fail("Could not resolve the orphan", 500);
  }
}
