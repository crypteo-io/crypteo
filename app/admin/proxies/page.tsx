import { ProxiesClient } from "@/components/dashboard/ProxiesClient";
import { adminPageSession } from "@/lib/admin";
import { isProxyStorageAvailable, listProxies, proxyView } from "@/lib/proxy-settings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proxies",
  description: "Outbound proxies for chain and price reads.",
};

export default async function AdminProxiesPage() {
  await adminPageSession();
  const proxies = await listProxies();
  return <ProxiesClient initial={proxies.map(proxyView)} storageAvailable={isProxyStorageAvailable()} />;
}
