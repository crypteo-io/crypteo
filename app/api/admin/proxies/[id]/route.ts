import { auditLog, requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { maskProxyUrl } from "@/lib/proxy-rotation";
import {
  decryptProxyUrl,
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

const ID = /^[a-z0-9]{20,40}$/;
type Params = { params: Promise<{ id: string }> };

/** Change a proxy's URL, label or whether it's used. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid proxy id" }, { status: 400 });
  const parsed = parseProxyInput(await req.json().catch(() => null), "update");
  if ("error" in parsed) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const { url, label, isActive } = parsed.data;
  if (url !== undefined && !isProxyStorageAvailable()) {
    return NextResponse.json({ error: "Proxies can't be stored: TWO_FACTOR_ENCRYPTION_KEY is not configured." }, { status: 503 });
  }

  try {
    if (url !== undefined && isDuplicateProxy(await listProxies(), url, id)) {
      return NextResponse.json({ error: "That proxy is already in the list.", field: "url" }, { status: 409 });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const { count } = await tx.outboundProxy.updateMany({
        where: { id },
        data: {
          ...(url !== undefined ? { url: encryptProxyUrl(url) } : {}),
          ...(label !== undefined ? { label } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
      });
      if (!count) return null;
      await auditLog(tx, admin, id, "proxy.update", {
        ...(url !== undefined ? { host: maskProxyUrl(url), urlChanged: true } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      });
      return tx.outboundProxy.findUnique({ where: { id } });
    });
    if (!updated) return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
    await syncProxies();
    return NextResponse.json({ proxy: proxyView({ ...updated, url: decryptProxyUrl(updated.url) }) });
  } catch (error) {
    console.error("[admin/proxies/:id]", error);
    return NextResponse.json({ error: "Could not update the proxy" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid proxy id" }, { status: 400 });

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const row = await tx.outboundProxy.findUnique({ where: { id } });
      if (!row) return false;
      await tx.outboundProxy.delete({ where: { id } });
      const url = decryptProxyUrl(row.url);
      await auditLog(tx, admin, id, "proxy.delete", { host: url ? maskProxyUrl(url) : null, label: row.label });
      return true;
    });
    if (!deleted) return NextResponse.json({ error: "Proxy not found" }, { status: 404 });
    await syncProxies();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/proxies/:id]", error);
    return NextResponse.json({ error: "Could not delete the proxy" }, { status: 500 });
  }
}
