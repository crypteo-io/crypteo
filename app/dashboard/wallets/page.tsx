import { WalletsClient } from "@/components/dashboard/WalletsClient";
import { auth } from "@/lib/auth";
import { isValidAddress } from "@/lib/chains/address";
import { prisma } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wallets",
  description: "Configure your receiving wallet addresses.",
};

export default async function WalletsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const wallets = await prisma.wallet.findMany({
    where: { merchantId: session.user.id },
  });

  // Wallets saved before address validation existed can hold an address that
  // isn't valid on their chain; checkout no longer offers them, so say why.
  const invalidAddresses: Record<string, string> = {};
  for (const w of wallets) {
    const chain = w.chain.toLowerCase();
    if (!isValidAddress(chain, w.address)) {
      invalidAddresses[`${chain}-${w.token.toLowerCase()}`] = w.address;
    }
  }

  return (
    <WalletsClient
      wallets={JSON.parse(JSON.stringify(wallets))}
      invalidAddresses={invalidAddresses}
    />
  );
}
