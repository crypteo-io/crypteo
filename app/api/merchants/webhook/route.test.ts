import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { update: vi.fn() } } }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/security", () => ({ isSafeWebhookUrl: vi.fn(() => true) }));

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PUT } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const update = mock(prisma.merchant.update);

function put(body: unknown) {
  return PUT(
    new NextRequest("https://app.example/api/merchants/webhook", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(auth).mockResolvedValue({ user: { id: "m1" } });
});

describe("PUT /api/merchants/webhook secret validation", () => {
  it("accepts a sound secret", async () => {
    const res = await put({
      defaultWebhookUrl: "https://m.example/h",
      webhookSecret: "s3cr3t-Value_0123456789",
    });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.webhookSecret).toBe(
      "s3cr3t-Value_0123456789",
    );
  });

  it.each([null, ""])("clears the secret with %j", async (webhookSecret) => {
    const res = await put({ defaultWebhookUrl: null, webhookSecret });
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.webhookSecret).toBeNull();
  });

  it.each([
    ["too short", "short"],
    ["too long", "a".repeat(257)],
    ["whitespace", "a".repeat(10) + " " + "b".repeat(10)],
    ["non-ASCII", "ä".repeat(20)],
    ["non-string", 12345678901234567890],
  ])("rejects a %s secret", async (_, webhookSecret) => {
    const res = await put({ defaultWebhookUrl: null, webhookSecret });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
