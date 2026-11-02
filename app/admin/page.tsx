import { DashboardOverviewClient } from "@/components/dashboard/DashboardOverviewClient";
import { adminPageSession } from "@/lib/admin";
import { loadOverview } from "@/lib/dashboard-overview";
import { nowDate } from "@/lib/time";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin overview",
  description: "Payment activity across every merchant.",
};

export default async function AdminOverview() {
  const session = await adminPageSession();
  return (
    <DashboardOverviewClient
      area="admin"
      merchantName={session.user.name ?? null}
      {...await loadOverview("platform", nowDate())}
    />
  );
}
