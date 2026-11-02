import { MerchantAdminClient } from "@/components/dashboard/MerchantAdminClient";
import { adminPageSession } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { STATEMENT_ADMIN_SELECT } from "@/lib/billing/statements";
import { effectiveTwoFactorMethod } from "@/lib/two-factor";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Every list on this page grows with the merchant's history; show the newest.
const RECENT_PAYMENTS = 50;
const RECENT_LINKS = 100;
const RECENT_AUDIT = 50;
const RECENT_STATEMENTS = 12;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // Metadata renders alongside the page: it must not read a merchant for a non-admin either.
  await adminPageSession();
  const { id } = await params;
  const merchant = await prisma.merchant.findUnique({ where: { id }, select: { name: true } });
  return { title: merchant?.name ?? "Merchant" };
}

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await adminPageSession();
  const { id } = await params;

  // Explicit selects: never a password hash, TOTP secret or webhook secret.
  const merchant = await prisma.merchant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      emailVerified: true,
      createdAt: true,
      twoFactorMethod: true,
      totpSecret: true,
      underpaidThreshold: true,
      feeExempt: true,
      feeExemptReason: true,
      feeExemptBy: true,
      feeExemptAt: true,
      billingHoldAt: true,
      wallets: {
        orderBy: { createdAt: "desc" },
        select: { id: true, chain: true, token: true, address: true, isActive: true, createdAt: true },
      },
      apiKeys: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          keyPrefix: true,
          label: true,
          isActive: true,
          isTest: true,
          lastUsedAt: true,
          createdAt: true,
        },
      },
      paymentLinks: {
        orderBy: { createdAt: "desc" },
        take: RECENT_LINKS,
        select: { id: true, title: true, amount: true, isActive: true, createdAt: true },
      },
      _count: {
        select: {
          payments: true,
          paymentLinks: true,
          webhookEndpoints: { where: { isActive: true } },
        },
      },
    },
  });
  if (!merchant) return notFound();

  const [payments, statusCounts, audit, statements] = await Promise.all([
    prisma.payment.findMany({
      where: { merchantId: id },
      orderBy: { createdAt: "desc" },
      take: RECENT_PAYMENTS,
      select: {
        id: true,
        status: true,
        chain: true,
        token: true,
        expectedAmount: true,
        receivedAmount: true,
        isTest: true,
        createdAt: true,
      },
    }),
    prisma.payment.groupBy({
      by: ["status"],
      where: { merchantId: id, isTest: false },
      _count: { _all: true },
    }),
    prisma.adminAuditLog.findMany({
      where: { merchantId: id },
      orderBy: { createdAt: "desc" },
      take: RECENT_AUDIT,
      select: { id: true, adminEmail: true, action: true, details: true, createdAt: true },
    }),
    prisma.feeStatement.findMany({
      where: { merchantId: id, status: { not: "draft" } },
      orderBy: { periodStart: "desc" },
      take: RECENT_STATEMENTS,
      select: STATEMENT_ADMIN_SELECT,
    }),
  ]);

  const { totpSecret, ...profile } = merchant;
  return (
    <MerchantAdminClient
      isSelf={merchant.id === session.user.id}
      data={JSON.parse(
        JSON.stringify({
          merchant: {
            ...profile,
            twoFactorMethod: effectiveTwoFactorMethod({
              twoFactorMethod: merchant.twoFactorMethod,
              totpSecret,
            }),
          },
          payments,
          statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count._all })),
          audit,
          statements,
          now: new Date(),
        }),
      )}
    />
  );
}
