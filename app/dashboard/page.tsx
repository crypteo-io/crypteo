import { DashboardOverviewClient } from "@/components/dashboard/DashboardOverviewClient";
import { auth } from "@/lib/auth";
import { loadOverview } from "@/lib/dashboard-overview";
import { webhookHealth } from "@/lib/payment/webhook-health";
import { nowDate } from "@/lib/time";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview",
  description: "View your payment statistics and recent transactions.",
};

export default async function DashboardOverview() {
  const session = await auth();
  if (!session?.user) return null;
  const now = nowDate();
  const [overview, webhooks] = await Promise.all([
    loadOverview({ merchantId: session.user.id }, now),
    webhookHealth(session.user.id, now),
  ]);
  return (
    <DashboardOverviewClient
      merchantName={session.user.name ?? null}
      area="merchant"
      {...overview}
      failingWebhooks={webhooks.filter((w) => w.failing && w.current)}
    />
  );
}
