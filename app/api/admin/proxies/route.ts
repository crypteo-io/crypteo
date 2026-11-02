import { auditLog, requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { maskProxyUrl } from "@/lib/proxy-rotation";
import {
  encryptProxyUrl,
  isDuplicateProxy,
  isProxyStorageAvailable,
  listProxies,
  parseProxyInput,
  proxyView,
  syncProxies,
} from "@/lib/proxy-settings";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

const STORAGE_OFF = "Proxies can't be stored: TWO_FACTOR_ENCRYPTION_KEY is not configured.";

/** Every stored proxy, with its URL (credentials included: admins only). */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const proxies = await listProxies();
    return NextResponse.json({ proxies: proxies.map(proxyView), storageAvailable: isProxyStorageAvailable() });
  } catch (error) {
    console.error("[admin/proxies]", error);
    return NextResponse.json({ error: "Could not load proxies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;
  if (!isProxyStorageAvailable()) return NextResponse.json({ error: STORAGE_OFF }, { status: 503 });

  const parsed = parseProxyInput(await req.json().catch(() => null), "create");
  if ("error" in parsed) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const { url, label = null, isActive = true } = parsed.data;
  if (!url) return NextResponse.json({ error: "Enter a proxy URL.", field: "url" }, { status: 400 });

  try {
    if (isDuplicateProxy(await listProxies(), url)) {
      return NextResponse.json({ error: "That proxy is already in the list.", field: "url" }, { status: 409 });
    }
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.outboundProxy.create({ data: { url: encryptProxyUrl(url), label, isActive } });
      // The host only: the audit log must never hold the credentials.
      await auditLog(tx, admin, row.id, "proxy.create", { host: maskProxyUrl(url), label, isActive });
      return row;
    });
    await syncProxies();
    return NextResponse.json({ proxy: proxyView({ ...created, url }) }, { status: 201 });
  } catch (error) {
    console.error("[admin/proxies]", error);
    return NextResponse.json({ error: "Could not add the proxy" }, { status: 500 });
  }
}
