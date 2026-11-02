import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: { findUnique: vi.fn() },
    apiKey: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    webhookEndpoint: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/mailer", () => ({ notifyAccountSecurityChange: vi.fn() }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { GET, PATCH, POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const notify = mock(notifyAccountSecurityChange);

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://app.example/api/api-keys", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.5" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
  mock(prisma.merchant.findUnique).mockResolvedValue({
    id: "m1",
    email: "owner@example.com",
    name: "Owner",
  });
  mock(prisma.apiKey.create).mockImplementation(async (a) => a.data);
  mock(prisma.webhookEndpoint.findUnique).mockResolvedValue(null);
});

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest("https://app.example/api/api-keys", { method: "PATCH", body: JSON.stringify(body) }),
  );
}

// One key per site: a key's payments go to the endpoint it names.
describe("API key webhook endpoint", () => {
  it("creates a key bound to the merchant's own endpoint", async () => {
    mock(prisma.webhookEndpoint.findUnique).mockResolvedValue({ merchantId: "m1" });
    const res = await post({ label: "Shop B", webhookEndpointId: "eb" });
    expect(res.status).toBe(200);
    expect(mock(prisma.apiKey.create).mock.calls[0][0].data.webhookEndpointId).toBe("eb");
  });

  it("refuses another merchant's endpoint", async () => {
    mock(prisma.webhookEndpoint.findUnique).mockResolvedValue({ merchantId: "other" });
    const res = await post({ webhookEndpointId: "ex" });
    expect(res.status).toBe(400);
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
    mock(prisma.apiKey.findUnique).mockResolvedValue({ id: "k1", merchantId: "m1" });
    expect((await patch({ id: "k1", webhookEndpointId: "ex" })).status).toBe(400);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it("re-points a key, or back to the default with null", async () => {
    mock(prisma.apiKey.findUnique).mockResolvedValue({ id: "k1", merchantId: "m1" });
    mock(prisma.apiKey.update).mockResolvedValue({ id: "k1" });
    expect((await patch({ id: "k1", webhookEndpointId: null })).status).toBe(200);
    expect(mock(prisma.apiKey.update).mock.calls[0][0].data).toEqual({ webhookEndpointId: null });
  });

  it("never changes another merchant's key", async () => {
    mock(prisma.apiKey.findUnique).mockResolvedValue({ id: "k9", merchantId: "other" });
    expect((await patch({ id: "k9", webhookEndpointId: null })).status).toBe(404);
  });

  it("never sends keyHash to the browser", async () => {
    (prisma.apiKey as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn(async () => []);
    await GET(new NextRequest("https://app.example/api/api-keys"));
    const select = (prisma.apiKey as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls[0][0].select;
    expect(select.keyHash).toBeUndefined();
    expect(select.keyPrefix).toBe(true);
  });
});

describe("POST /api/api-keys security notice", () => {
  it("emails the owner the prefix and mode, never the raw key", async () => {
    notify.mockResolvedValue(undefined);
    const res = await post({ label: "shop" });
    const { rawKey } = await res.json();

    const n = notify.mock.calls[0][0];
    expect(n.to).toBe("owner@example.com");
    expect(n.action).toBe("Live API key created");
    expect(n.ip).toBe("203.0.113.5");
    const text = JSON.stringify(n.details);
    expect(text).toContain(rawKey.slice(0, 12));
    expect(text).not.toContain(rawKey);
    expect(text).toContain("shop");
  });

  it("labels test keys as such", async () => {
    notify.mockResolvedValue(undefined);
    await post({ isTest: true });
    expect(notify.mock.calls[0][0].action).toBe("Test API key created");
  });

  it("does not wait on the mail send", async () => {
    notify.mockReturnValue(new Promise(() => {}));
    const res = await post({});
    expect(res.status).toBe(200);
  });
});
