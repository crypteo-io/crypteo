import { DashboardShell } from "@/components/layout/DashboardShell";
import { adminPageSession } from "@/lib/admin";

/** The admin dashboard, served at the root of the admin host (proxy.ts). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await adminPageSession();
  return (
    <DashboardShell area="admin" user={session.user}>
      {children}
    </DashboardShell>
  );
}
