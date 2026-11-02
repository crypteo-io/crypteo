import { CreatePaymentLinkClient } from "@/components/dashboard/CreatePaymentLinkClient";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { walletRefusal } from "@/lib/payment/wallets";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "New payment link",
};

export default async function CreatePaymentLinkPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [wallets, endpoints] = await Promise.all([
    prisma.wallet.findMany({
      where: { merchantId: session.user.id, isActive: true },
      select: { chain: true, token: true, address: true, isActive: true },
    }),
    prisma.webhookEndpoint.findMany({
      where: { merchantId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, url: true, label: true, isActive: true, isDefault: true },
    }),
  ]);

  // Each pair once, with the reason it can't be pinned (the same rule the
  // create route enforces), so the form can say so under the picker at once.
  const seen = new Set<string>();
  const availableWallets = wallets.flatMap((w) => {
    const chain = w.chain.toLowerCase();
    const token = w.token.toLowerCase();
    const key = `${chain}-${token}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ chain, token, problem: walletRefusal(w, chain) }];
  });

  return (
    <CreatePaymentLinkClient
      availableWallets={availableWallets}
      webhookEndpoints={endpoints}
    />
  );
}
