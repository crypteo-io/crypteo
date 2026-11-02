import { BillingAlert } from "@/components/billing/BillingAlert";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { adminOrigin } from "@/lib/admin-host";
import { auth } from "@/lib/auth";
import { billingAlert } from "@/lib/billing/merchant-view";
import { NOINDEX } from "@/lib/seo";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { robots: NOINDEX };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  // The proxy let this request in on a session cookie, so a null session here
  // means the account was suspended or deleted: clear the cookie, don't loop.
  if (!session?.user) redirect("/api/auth/session-ended");
  // An admin isn't a merchant: their dashboard is on the admin host.
  if (session.user.role === "admin") redirect(adminOrigin());
  // A banner must never take the dashboard down: the merchant needs it to pay.
  const billing = await billingAlert(session.user.id).catch((error) => {
    console.error("[dashboard] billing alert unavailable:", error);
    return null;
  });

  return (
    <DashboardShell
      area="merchant"
      user={session.user}
      banner={billing && <BillingAlert data={billing} now={new Date().toISOString()} />}
    >
      {children}
    </DashboardShell>
  );
}
