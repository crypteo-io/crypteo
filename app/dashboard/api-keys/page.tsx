import { ApiKeysClient } from "@/components/dashboard/ApiKeysClient";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "API keys",
  description: "Manage your API keys for integration.",
};

export default async function ApiKeysPage() {
  const session = await auth();
  if (!session?.user) return null;

  const keys = await prisma.apiKey.findMany({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "desc" },
    // keyHash never leaves the server — it is the credential's verifier.
    select: {
      id: true,
      createdAt: true,
      merchantId: true,
      keyPrefix: true,
      label: true,
      lastUsedAt: true,
      isActive: true,
      isTest: true,
      webhookEndpointId: true,
    },
  });
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { merchantId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, label: true, isActive: true, isDefault: true },
  });
  return (
    <ApiKeysClient
      apiKeys={JSON.parse(JSON.stringify(keys))}
      webhookEndpoints={endpoints}
    />
  );
}
