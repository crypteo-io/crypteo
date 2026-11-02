import { OrphansClient } from "@/components/dashboard/OrphansClient";
import { adminPageSession } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { orphanKind } from "@/lib/payment/orphan-review";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orphan transactions",
  description: "Review deposits no payment session could be matched to (Admin only).",
};

// Open orphans are all shown (they are the work queue); resolved ones are
// history, so only the newest.
const MAX_OPEN = 1000;
const MAX_RESOLVED = 200;

export default async function OrphansPage() {
  await adminPageSession();

  const [open, resolved] = await Promise.all([
    prisma.orphanTransaction.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: MAX_OPEN,
    }),
    prisma.orphanTransaction.findMany({
      where: { resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: MAX_RESOLVED,
    }),
  ]);

  const addresses = [...new Set([...open, ...resolved].map((o) => o.walletAddress))];
  const wallets = await prisma.wallet.findMany({
    where: { address: { in: addresses } },
    select: { address: true, chain: true, merchant: { select: { id: true, name: true } } },
  });
  const ownerOf = (o: { walletAddress: string; chain: string }) =>
    wallets.find((w) => w.address === o.walletAddress && w.chain === o.chain)?.merchant ?? null;

  const rows = [...open, ...resolved].map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    chain: o.chain,
    token: o.token,
    receivedAmount: o.receivedAmount,
    walletAddress: o.walletAddress,
    txHash: o.txHash,
    kind: orphanKind(o.txHash),
    resolvedAt: o.resolvedAt,
    resolvedToPaymentId: o.resolvedToPaymentId,
    notes: o.notes,
    owner: ownerOf(o),
  }));

  return <OrphansClient rows={JSON.parse(JSON.stringify(rows))} />;
}
