import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: { findUnique: vi.fn(), update: vi.fn() },
    merchant: { findUnique: vi.fn() },
    webhookLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  rateLimitScoped: vi.fn(),
}));
vi.mock("@/lib/security", () => ({ isSafeWebhookUrl: vi.fn(() => true) }));
vi.mock("@/lib/payment/notify", async (importOriginal) => ({
  webhookTarget: (await importOriginal<typeof import("@/lib/payment/notify")>()).webhookTarget,
  loadWebhookConfig: vi.fn(),
  buildWebhookPayload: vi.fn(() => ({ eventId: "e" })),
  sendWebhookRequest: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadWebhookConfig, sendWebhookRequest } from "@/lib/payment/notify";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const update = mock(prisma.payment.update);

function resend() {
  return POST(
    new NextRequest("https://app.example/api/webhooks/p1", { method: "POST" }),
    { params: Promise.resolve({ paymentId: "p1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1", role: "merchant" } });
  mock(prisma.payment.findUnique).mockResolvedValue({
    id: "p1",
    merchantId: "m1",
    webhookUrl: "https://m.example/h",
    webhookAttempts: 2,
    nextWebhookRetryAt: new Date(),
  });
  mock(loadWebhookConfig).mockResolvedValue({ active: true, secret: "s", endpoints: [] });
});

describe("POST /api/webhooks/[paymentId] (manual resend)", () => {
  it("resends a payment without its own URL to its one endpoint", async () => {
    mock(prisma.payment.findUnique).mockResolvedValue({
      id: "p1",
      merchantId: "m1",
      webhookUrl: null,
      webhookEndpointId: null,
      webhookAttempts: 1,
    });
    mock(loadWebhookConfig).mockResolvedValue({
      active: true,
      secret: "s",
      endpoints: [
        { id: "a", url: "https://a.example/h", isActive: true, isDefault: true },
        { id: "b", url: "https://b.example/h", isActive: true, isDefault: false },
      ],
    });
    mock(sendWebhookRequest).mockResolvedValue({ success: true, statusCode: 200, response: "ok" });
    const res = await resend();
    expect(res.status).toBe(200);
    expect(mock(sendWebhookRequest).mock.calls.map((c) => c[0].url)).toEqual(["https://a.example/h"]);
  });

  it("refuses for a suspended merchant, even from an admin", async () => {
    mock(auth).mockResolvedValue({ user: { id: "admin1", role: "admin" } });
    mock(loadWebhookConfig).mockResolvedValue({ active: false, secret: null, endpoints: [] });
    expect((await resend()).status).toBe(403);
    expect(sendWebhookRequest).not.toHaveBeenCalled();
  });

  it("404s when there is nowhere to send", async () => {
    mock(prisma.payment.findUnique).mockResolvedValue({ id: "p1", merchantId: "m1", webhookUrl: null });
    expect((await resend()).status).toBe(404);
  });

  it("a failed resend leaves the automatic retry schedule untouched", async () => {
    mock(sendWebhookRequest).mockResolvedValue({
      success: false,
      statusCode: 500,
      response: "err",
    });
    await resend();
    expect(update).not.toHaveBeenCalled();
  });

  it("a successful resend settles the event without consuming a retry", async () => {
    mock(sendWebhookRequest).mockResolvedValue({
      success: true,
      statusCode: 200,
      response: "ok",
    });
    await resend();
    const data = update.mock.calls[0][0].data;
    expect(data.nextWebhookRetryAt).toBeNull();
    expect(data.webhookSentAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty("webhookAttempts");
  });
});
