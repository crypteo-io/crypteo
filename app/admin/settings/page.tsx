import { SettingsClient } from "@/components/dashboard/SettingsClient";
import { adminPageSession } from "@/lib/admin";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your admin profile and sign-in security.",
};

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await adminPageSession();
  const { tab } = await searchParams;
  return <SettingsClient user={session.user} initialTab={tab} area="admin" />;
}
