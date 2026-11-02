import { MerchantsClient } from "@/components/dashboard/MerchantsClient";
import { adminPageSession } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { isDisposableEmail } from "@/lib/email-quality";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Merchants",
  description: "View and manage merchant accounts (Admin only).",
};

// Filtering and search run client-side over this list; past this many
// accounts the page needs server-side paging.
const MAX_MERCHANTS_LISTED = 2000;

export default async function MerchantsPage() {
  await adminPageSession();

  // Only the columns MerchantsClient renders. A bare findMany() serialised
  // every merchant's password hash, reset token and webhookSecret into the
  // admin's page payload.
  const merchants = await prisma.merchant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      emailVerified: true,
      twoFactorMethod: true,
      createdAt: true,
      billingHoldAt: true,
      _count: { select: { payments: true, wallets: true } },
    },
    take: MAX_MERCHANTS_LISTED,
  });
  // Flagged here, not in the client: the blocklist is ~141k domains.
  const listed = merchants.map((m) => ({ ...m, disposableEmail: isDisposableEmail(m.email) }));
  return <MerchantsClient merchants={JSON.parse(JSON.stringify(listed))} />;
}
