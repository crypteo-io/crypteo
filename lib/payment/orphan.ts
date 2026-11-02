import { adminUrl } from "../admin-host";
import { prisma } from "../db";
import { sendAdminAlert } from "../admin-alerts";
import { orphanDetectedHtml } from "../emails/templates";
import { formatAmount } from "../format";
import { notifyAdmins } from "../notifications";

/**
 * Log an unmatched transaction as an orphan for admin review.
 * Alerts ADMIN_EMAILS (lib/admin-alerts.ts).
 */
export async function logOrphanTransaction(params: {
  txHash: string;
  walletAddress: string;
  chain: string;
  token: string;
  receivedAmount: number;
  blockTime?: Date;
}) {
  const { txHash, walletAddress, chain, token, receivedAmount, blockTime } =
    params;

  // Deduplicate — don't log the same tx twice
  const existing = await prisma.orphanTransaction.findUnique({
    where: { txHash },
  });
  if (existing) return existing;

  const orphan = await prisma.orphanTransaction.create({
    data: {
      txHash,
      walletAddress,
      chain,
      token,
      receivedAmount,
      blockTime: blockTime || null,
    },
  });

  console.warn(
    `[${new Date().toISOString()}] ORPHAN TX logged: ${txHash}: ${receivedAmount} ${token.toUpperCase()} on ${chain.toUpperCase()} to ${walletAddress}`,
  );

  // Operators review orphans; merchants never get this alert.
  const dashboardUrl = adminUrl("/orphans");

  await sendAdminAlert(
    `⚠️ Orphan Transaction Detected: ${txHash.slice(0, 12)}...`,
    orphanDetectedHtml({
      txHash,
      receivedAmount,
      token,
      chain,
      walletAddress,
      blockTime: blockTime?.toISOString() ?? null,
      dashboardUrl: dashboardUrl ?? null,
    }),
  ).catch(console.error);
  await notifyAdmins({
    kind: "admin_orphan",
    title: `Unmatched deposit: ${formatAmount(receivedAmount, token)} ${token.toUpperCase()}`,
    body: `${chain.toUpperCase()} deposit no session could claim. Review it in Orphans.`,
    link: `/orphans/${orphan.id}`,
  });

  return orphan;
}
