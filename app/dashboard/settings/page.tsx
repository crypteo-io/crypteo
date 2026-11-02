import { SettingsClient } from "@/components/dashboard/SettingsClient";
import { auth } from "@/lib/auth";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Update your profile and security settings.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { tab } = await searchParams;
  return <SettingsClient user={session.user} initialTab={tab} area="merchant" />;
}
