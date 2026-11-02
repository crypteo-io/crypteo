import { AnalyticsClient } from "@/components/dashboard/AnalyticsClient";
import { platformAnalytics } from "@/lib/admin-analytics";
import { adminPageSession } from "@/lib/admin";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics",
  description: "Platform-wide payment and merchant analytics (Admin only).",
};

export default async function AnalyticsPage() {
  await adminPageSession();
  return <AnalyticsClient data={await platformAnalytics()} />;
}
