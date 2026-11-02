import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  outboundProxy: { create: vi.fn() },
  adminAuditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: { outboundProxy: { findMany: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin")>()),
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { proxyManager } from "@/lib/proxy-rotation";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ADMIN = { id: "cadmin0000000000000000001", email: "admin@x.co" };
const URL_WITH_CREDS = "http://user:s3cret@proxy.example:8080";

const create = (body: unknown) =>
  POST(new NextRequest("https://admin.example/api/admin/proxies", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  process.env.TWO_FACTOR_ENCRYPTION_KEY = "k".repeat(40);
  mock(requireAdmin).mockResolvedValue({ admin: ADMIN });
  mock(prisma.outboundProxy.findMany).mockResolvedValue([]);
  mock(prisma.$transaction).mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
  tx.outboundProxy.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "cproxy0000000000000000001",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...data,
  }));
  proxyManager.setProxies([]);
});

describe("POST /api/admin/proxies", () => {
  it("refuses a non-admin before writing anything", async () => {
    mock(requireAdmin).mockResolvedValue({ response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await create({ url: URL_WITH_CREDS })).status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("stores the URL encrypted, audits the host only, and puts it into rotation", async () => {
    // After the write, syncProxies reads the stored rows back.
    mock(prisma.outboundProxy.findMany).mockResolvedValueOnce([]).mockImplementation(async () => [
      { ...(await tx.outboundProxy.create.mock.results[0].value) },
    ]);
    const res = await create({ url: URL_WITH_CREDS, label: "EU" });
    expect(res.status).toBe(201);

    const stored = tx.outboundProxy.create.mock.calls[0][0].data.url as string;
    expect(stored).not.toContain("s3cret");
    expect(JSON.stringify(tx.adminAuditLog.create.mock.calls)).not.toContain("s3cret");
    expect(tx.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "proxy.create", details: { host: "http://proxy.example:8080" } });
    expect(proxyManager.getProxy()).toBe(URL_WITH_CREDS);
  });

  it("refuses an unusable URL under its field, and a duplicate", async () => {
    const bad = await create({ url: "socks5://proxy.example:1080" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: "url" });

    const { encryptProxyUrl } = await import("@/lib/proxy-settings");
    mock(prisma.outboundProxy.findMany).mockResolvedValue([
      { id: "cproxy0000000000000000009", url: encryptProxyUrl(URL_WITH_CREDS), label: null, isActive: true, createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    expect((await create({ url: URL_WITH_CREDS })).status).toBe(409);
  });

  it("fails closed without the encryption key", async () => {
    delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
    expect((await create({ url: URL_WITH_CREDS })).status).toBe(503);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
