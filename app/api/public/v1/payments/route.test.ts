import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { payment: { create: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/security", () => ({ isSafeWebhookUrl: vi.fn(async () => true) }));

import { validateApiKey } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { POST } from "./route";

const create = prisma.payment.create as unknown as ReturnType<typeof vi.fn>;
const call = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("https://app.example/api/public/v1/payments", {
      method: "POST",
      body: JSON.stringify({ amount: 25, ...body }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  (validateApiKey as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    merchant: { id: "m1" },
    isTest: false,
    webhookEndpointId: "eb",
  });
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "p1",
    expiresAt: new Date(),
    ...data,
  }));
});

// One key per site: the key's endpoint is where its payments' webhooks go,
// unless the request names its own URL.
describe("POST /api/public/v1/payments webhook destination", () => {
  it("routes to the creating key's endpoint", async () => {
    expect((await call({})).status).toBe(200);
    expect(create.mock.calls[0][0].data).toMatchObject({ webhookUrl: null, webhookEndpointId: "eb" });
  });

  it("an explicit webhookUrl wins over the key's endpoint", async () => {
    await call({ webhookUrl: "https://site-b.example/hook" });
    expect(create.mock.calls[0][0].data).toMatchObject({
      webhookUrl: "https://site-b.example/hook",
      webhookEndpointId: null,
    });
  });
});

describe("POST /api/public/v1/payments return URLs", () => {
  it("stores the merchant's success and cancel pages", async () => {
    await call({ successUrl: "https://shop.example/thanks", cancelUrl: "http://shop.example/cart" });
    expect(create.mock.calls[0][0].data).toMatchObject({
      successUrl: "https://shop.example/thanks",
      cancelUrl: "http://shop.example/cart",
    });
  });

  it("refuses a URL the browser would run as script", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "not a url"]) {
      expect((await call({ successUrl: url })).status).toBe(400);
      expect((await call({ cancelUrl: url })).status).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });
});
