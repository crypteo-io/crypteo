import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const prisma = {
    webhookEndpoint: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    apiKey: { groupBy: vi.fn(async () => []), count: vi.fn(async () => 0) },
    paymentLink: { groupBy: vi.fn(async () => []), count: vi.fn(async () => 0) },
    merchant: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  rateLimitScoped: vi.fn(),
  clientIp: () => "203.0.113.9",
}));
vi.mock("@/lib/security", () => ({ isSafeWebhookUrl: vi.fn(async () => true) }));
vi.mock("@/lib/mailer", () => ({ notifyAccountSecurityChange: vi.fn(async () => {}) }));
vi.mock("@/lib/payment/webhook-health", () => ({ webhookHealth: vi.fn(async () => []) }));
vi.mock("@/lib/payment/notify", () => ({
  MAX_WEBHOOK_ENDPOINTS: 10,
  sendWebhookRequest: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { sendWebhookRequest } from "@/lib/payment/notify";
import { isSafeWebhookUrl } from "@/lib/security";
import { DELETE, PATCH } from "./[id]/route";
import { POST as TEST } from "./[id]/test/route";
import { GET, POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ep = prisma.webhookEndpoint;
const req = (method: string, body?: unknown) =>
  new NextRequest("https://app.example/api/merchants/webhook-endpoints", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const URL_A = "https://site-a.example/webhooks/crypteo";

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
  mock(ep.count).mockResolvedValue(0);
  mock(ep.findUnique).mockResolvedValue(null);
  mock(ep.create).mockImplementation(async ({ data }: { data: object }) => ({ id: "e1", isActive: true, ...data }));
  mock(prisma.apiKey.count).mockResolvedValue(0);
  mock(prisma.paymentLink.count).mockResolvedValue(0);
  mock(prisma.merchant.findUnique).mockResolvedValue({ email: "m@example.com", name: "M", webhookSecret: "s".repeat(16) });
  mock(isSafeWebhookUrl).mockResolvedValue(true);
});

describe("webhook endpoints API", () => {
  it("requires a session", async () => {
    mock(auth).mockResolvedValue(null);
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await POST(req("POST", { url: URL_A }))).status).toBe(401);
  });

  it("adds an endpoint and tells the owner", async () => {
    const res = await POST(req("POST", { url: URL_A, label: "Main store" }));
    expect(res.status).toBe(200);
    expect(mock(ep.create).mock.calls[0][0].data).toEqual({
      merchantId: "m1",
      url: URL_A,
      label: "Main store",
      isDefault: true, // the first endpoint becomes the default
    });
    expect(notifyAccountSecurityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Webhook endpoint added", to: "m@example.com" }),
    );
  });

  it("refuses a malformed URL, naming the field", async () => {
    const res = await POST(req("POST", { url: "not a url" }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("url");
    expect(ep.create).not.toHaveBeenCalled();
  });

  it("refuses a URL that isn't a public address (SSRF guard)", async () => {
    mock(isSafeWebhookUrl).mockResolvedValue(false);
    const res = await POST(req("POST", { url: "http://169.254.169.254/latest" }));
    expect(res.status).toBe(400);
    expect(ep.create).not.toHaveBeenCalled();
  });

  it("caps the number of endpoints", async () => {
    mock(ep.count).mockResolvedValue(10);
    const res = await POST(req("POST", { url: URL_A }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/up to 10/);
  });

  it("refuses a duplicate URL", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e0", merchantId: "m1", url: URL_A });
    expect((await POST(req("POST", { url: URL_A }))).status).toBe(409);
  });

  it("never lets one merchant edit, delete or test another's endpoint", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e9", merchantId: "other", url: URL_A });
    expect((await PATCH(req("PATCH", { isActive: false }), params("e9"))).status).toBe(404);
    expect((await DELETE(req("DELETE"), params("e9"))).status).toBe(404);
    expect((await TEST(req("POST"), params("e9"))).status).toBe(404);
    expect(ep.update).not.toHaveBeenCalled();
    expect(ep.delete).not.toHaveBeenCalled();
    expect(sendWebhookRequest).not.toHaveBeenCalled();
  });

  it("re-checks a changed URL and tells the owner", async () => {
    mock(ep.findUnique).mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? { id: "e1", merchantId: "m1", url: URL_A } : null,
    );
    mock(ep.update).mockResolvedValue({ id: "e1", url: "https://site-b.example/h", label: null, isActive: true });
    mock(isSafeWebhookUrl).mockResolvedValue(false);
    expect((await PATCH(req("PATCH", { url: "https://internal.example/h" }), params("e1"))).status).toBe(400);

    mock(isSafeWebhookUrl).mockResolvedValue(true);
    expect((await PATCH(req("PATCH", { url: "https://site-b.example/h" }), params("e1"))).status).toBe(200);
    expect(notifyAccountSecurityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: "Webhook endpoint changed" }),
    );
  });

  it("sends a signed webhook.test event to the merchant's own endpoint", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e1", merchantId: "m1", url: URL_A });
    mock(sendWebhookRequest).mockResolvedValue({ success: false, statusCode: 405, response: "<html>405</html>" });
    const res = await TEST(req("POST"), params("e1"));
    const body = await res.json();
    expect(body).toMatchObject({ success: false, statusCode: 405 });
    const call = mock(sendWebhookRequest).mock.calls[0][0];
    expect(call.url).toBe(URL_A);
    expect(call.payload).toMatchObject({ event: "webhook.test", payment: null });
    expect(call.secret).toBe("s".repeat(16));
  });

  it("leaves the label alone on a PATCH that doesn't send one", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e2", merchantId: "m1", url: URL_A, label: "Shop A" });
    mock(ep.update).mockResolvedValue({ id: "e2", url: URL_A, isActive: false });
    await PATCH(req("PATCH", { isActive: false }), params("e2"));
    expect(mock(ep.update).mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it("doesn't make a later endpoint the default", async () => {
    mock(ep.count).mockImplementation(async ({ where }: { where: { isDefault?: boolean } }) =>
      where.isDefault ? 1 : 1,
    );
    await POST(req("POST", { url: URL_A }));
    expect(mock(ep.create).mock.calls[0][0].data.isDefault).toBe(false);
  });

  it("moves the default: the previous one is cleared in the same transaction", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e2", merchantId: "m1", url: URL_A });
    mock(ep.update).mockResolvedValue({ id: "e2", url: URL_A, isDefault: true });
    expect((await PATCH(req("PATCH", { isDefault: true }), params("e2"))).status).toBe(200);
    expect(mock(ep.updateMany).mock.calls[0][0]).toEqual({
      where: { merchantId: "m1", isDefault: true, id: { not: "e2" } },
      data: { isDefault: false },
    });
    expect(mock(ep.update).mock.calls[0][0].data).toEqual({ isDefault: true });
  });

  // Payments from a key or link that names the endpoint would have nowhere
  // to go: they are never re-routed to another site's endpoint.
  it("refuses to delete an endpoint an active API key or link still uses", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e1", merchantId: "m1", url: URL_A });
    mock(prisma.apiKey.count).mockResolvedValue(2);
    mock(prisma.paymentLink.count).mockResolvedValue(1);
    const res = await DELETE(req("DELETE"), params("e1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/2 API keys and 1 payment link/);
    expect(ep.delete).not.toHaveBeenCalled();
  });

  it("deletes an unused endpoint", async () => {
    mock(ep.findUnique).mockResolvedValue({ id: "e1", merchantId: "m1", url: URL_A });
    expect((await DELETE(req("DELETE"), params("e1"))).status).toBe(200);
    expect(ep.delete).toHaveBeenCalledWith({ where: { id: "e1" } });
  });
});
