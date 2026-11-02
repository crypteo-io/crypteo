import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), rateLimitScoped: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(() => true) }));
vi.mock("@/lib/otp", () => ({
  generateOtp: vi.fn(() => "123456"),
  otpRecentlySent: vi.fn(async () => false),
  otpRecipients: vi.fn((email: string) => [email]),
}));
vi.mock("@/lib/mailer", () => ({ sendEmailToEach: vi.fn(async () => 1) }));

import { prisma } from "@/lib/db";
import { generateOtp, otpRecentlySent } from "@/lib/otp";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mock(otpRecentlySent).mockResolvedValue(false);
});

describe("POST /api/auth/forgot-password", () => {
  it("looks the account up by lowercased, trimmed email", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({ id: "m1" });
    await POST(
      new NextRequest("https://app.example/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: " Owner@Example.COM ", turnstileToken: "t" }),
      }),
    );
    expect(mock(prisma.merchant.findUnique).mock.calls[0][0]).toEqual({
      where: { email: "owner@example.com" },
    });
    expect(generateOtp).toHaveBeenCalledWith("owner@example.com", "PASSWORD_RESET");
  });
});

describe("POST /api/auth/forgot-password abuse", () => {
  const post = (body: string) =>
    POST(new NextRequest("https://app.example/api/auth/forgot-password", { method: "POST", body }));

  it("answers a malformed body with 400, not 500", async () => {
    expect((await post("notjson")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
  });

  it("sends no second code within the cooldown, with the same answer", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({ id: "m1", role: "merchant" });
    mock(otpRecentlySent).mockResolvedValue(true);
    const res = await post(JSON.stringify({ email: "owner@example.com", turnstileToken: "t" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(generateOtp).not.toHaveBeenCalled();
  });
});
