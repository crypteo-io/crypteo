import { PaymentDetailClient } from "@/components/dashboard/PaymentDetailClient";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadWebhookConfig, webhookTarget } from "@/lib/payment/notify";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Payment details",
};

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const { id } = await params;

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment || payment.merchantId !== session.user.id) return notFound();

  // The delivery log shows status, attempt and time. The payload and the
  // endpoint's full response body are not rendered, and a response body can
  // be arbitrarily large (an HTML error page), so they stay on the server.
  const webhookLogs = await prisma.webhookLog.findMany({
    where: { paymentId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      paymentId: true,
      url: true,
      statusCode: true,
      attempt: true,
      success: true,
    },
  });
  const { active, endpoints } = await loadWebhookConfig(payment.merchantId);
  const emailLogs = await prisma.emailLog.findMany({
    where: { paymentId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <PaymentDetailClient
      payment={JSON.parse(JSON.stringify(payment))}
      webhookLogs={JSON.parse(JSON.stringify(webhookLogs))}
      webhookUrl={active ? webhookTarget(payment, endpoints) : null}
      emailLogs={JSON.parse(JSON.stringify(emailLogs))}
    />
  );
}
