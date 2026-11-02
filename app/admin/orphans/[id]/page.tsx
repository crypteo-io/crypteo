import { OrphanReviewClient } from "@/components/dashboard/OrphanReviewClient";
import { adminPageSession } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { orphanKind, planOrphanCredit, refuseCredit } from "@/lib/payment/orphan-review";
import { nowMs } from "@/lib/time";
import { notFound } from "next/navigation";

// Sessions on the same wallet created in this window before the deposit are
// candidates; a buyer pays within a session's life, so older ones can't be it.
const CANDIDATE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const CANDIDATE_LOOKAHEAD_MS = 60 * 60 * 1000;
const MAX_CANDIDATES = 60;

export default async function OrphanReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await adminPageSession();
  const { id } = await params;

  const orphan = await prisma.orphanTransaction.findUnique({ where: { id } });
  if (!orphan) return notFound();

  const seenAt = (orphan.blockTime ?? orphan.createdAt).getTime();
  const [wallet, sessions, resolvedTo] = await Promise.all([
    prisma.wallet.findFirst({
      where: { address: orphan.walletAddress, chain: orphan.chain },
      select: { merchant: { select: { id: true, name: true, underpaidThreshold: true } } },
    }),
    prisma.payment.findMany({
      where: {
        walletAddress: orphan.walletAddress,
        chain: orphan.chain,
        token: orphan.token,
        isTest: false,
        createdAt: {
          gte: new Date(seenAt - CANDIDATE_LOOKBACK_MS),
          lte: new Date(seenAt + CANDIDATE_LOOKAHEAD_MS),
        },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_CANDIDATES,
      include: { merchant: { select: { underpaidThreshold: true } } },
    }),
    orphan.resolvedToPaymentId
      ? prisma.payment.findUnique({
          where: { id: orphan.resolvedToPaymentId },
          select: { id: true, status: true, receivedAmount: true, expectedAmount: true },
        })
      : null,
  ]);

  const now = nowMs();
  const candidates = sessions
    .map((p) => ({
      id: p.id,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      status: p.status,
      expectedAmount: p.expectedAmount,
      receivedAmount: p.receivedAmount,
      externalId: p.externalId,
      distance: Math.abs(p.expectedAmount - (orphan.receivedAmount + (p.receivedAmount ?? 0))),
      refusal: orphan.resolvedAt ? "Orphan already resolved" : refuseCredit(orphan, p, now),
      outcome: planOrphanCredit(p, orphan.receivedAmount, p.merchant.underpaidThreshold),
    }))
    .sort((a, b) => Number(!!a.refusal) - Number(!!b.refusal) || a.distance - b.distance);

  return (
    <OrphanReviewClient
      data={JSON.parse(
        JSON.stringify({
          orphan: { ...orphan, kind: orphanKind(orphan.txHash) },
          owner: wallet?.merchant ? { id: wallet.merchant.id, name: wallet.merchant.name } : null,
          resolvedTo,
          candidates,
        }),
      )}
    />
  );
}
