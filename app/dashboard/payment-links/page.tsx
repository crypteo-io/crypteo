import { CustomDomainCard } from "@/components/dashboard/CustomDomainCard";
import { PaymentLinksClient } from "@/components/dashboard/PaymentLinksClient";
import { cnameTarget, verificationName, verificationValue } from "@/lib/custom-domain";
import { TelegramCard } from "@/components/dashboard/TelegramCard";
import { telegramConfigured } from "@/lib/telegram/api";
import { HOST_MERCHANT_SELECT, paymentLinkUrl } from "@/lib/custom-host";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PAID_STATUSES } from "@/lib/payment/status";
import { nowMs } from "@/lib/time";
import { PaymentLink } from "@/types/payment";
import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Payment links",
  description: "Create and manage shareable payment links.",
};

export default async function PaymentLinksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const links = await prisma.paymentLink.findMany({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      payments: {
        where: { status: { in: [...PAID_STATUSES] } },
        select: { id: true },
      },
    },
  });
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { ...HOST_MERCHANT_SELECT, customDomainToken: true },
  });
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { merchantId: session.user.id },
    select: { id: true, url: true, label: true },
  });
  const telegramChats = await prisma.telegramChat.findMany({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, kind: true, notifyPaid: true },
  });
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  // Only links that don't use the default endpoint show where they send.
  const destinationOf = (link: { webhookUrl: string | null; webhookEndpointId: string | null }) => {
    if (link.webhookUrl) return hostOf(link.webhookUrl);
    if (!link.webhookEndpointId) return null;
    const endpoint = endpoints.find((e) => e.id === link.webhookEndpointId);
    if (!endpoint) return "a deleted endpoint (nothing is sent)";
    return endpoint.label || hostOf(endpoint.url);
  };

  const formattedLinks: PaymentLink[] = links.map(
    (link: (typeof links)[0]) => ({
      id: link.id,
      title: link.title,
      description: link.description,
      amount: link.amount,
      chain: link.chain,
      token: link.token,
      paymentLimit: link.paymentLimit,
      paymentsCount: link.payments.length,
      isActive: link.isActive,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
      merchantId: link.merchantId,
      updatedAt: link.updatedAt,
      walletAddress: link.walletAddress,
      webhookUrl: link.webhookUrl,
      webhookDestination: destinationOf(link),
      url: paymentLinkUrl(link.id, merchant),
    }),
  );

  // The request-time clock decides which links render as expired, so the
  // server HTML and the client's hydration render agree.
  const { customDomain: domain, customDomainToken: token, customDomainVerifiedAt } = merchant;
  return (
    <PaymentLinksClient
      initialLinks={formattedLinks}
      renderedAt={nowMs()}
      telegramCard={telegramConfigured() ? <TelegramCard chats={telegramChats} /> : null}
      domainCard={
        <CustomDomainCard
          cnameTarget={cnameTarget()}
          initial={{
            domain,
            verified: !!customDomainVerifiedAt,
            txtName: domain ? verificationName(domain) : null,
            txtValue: token ? verificationValue(token) : null,
          }}
        />
      }
    />
  );
}
