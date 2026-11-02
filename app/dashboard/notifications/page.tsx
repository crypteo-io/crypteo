import { NotificationsClient } from "@/components/layout/NotificationsClient";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Notifications",
  description: "Your payment, billing and account notifications.",
};

const SHOWN = 100;

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const items = await prisma.notification.findMany({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: SHOWN,
    select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
  return <NotificationsClient items={JSON.parse(JSON.stringify(items))} />;
}
