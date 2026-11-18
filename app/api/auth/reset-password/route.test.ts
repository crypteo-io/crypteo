import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), rateLimitScoped: vi.fn(), clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock("@/lib/otp", () => ({ verifyOtp: vi.fn(async () => true) }));
vi.mock("@/lib/mailer", () => ({ notifyAccountSecurityChange: vi.fn(async () => {}) }));
vi.mock("argon2", () => ({ hash: vi.fn(async () => "hashed") }));

import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { verifyOtp } from "@/lib/otp";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ADMIN = { id: "a1", name: "Admin", email: "admin@crypteo.io", role: "admin" };
const MERCHANT = { id: "m1", name: "Shop", email: "owner@example.com", role: "merchant" };

const reset = (email: string, host: string) =>
  POST(
    new NextRequest(`https://${host}/api/auth/reset-password`, {
      method: "POST",
      headers: { host },
      body: JSON.stringify({ email, otp: "123456", password: "N3w-Password!", turnstileToken: "t" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mock(verifyOtp).mockResolvedValue(true);
});

describe("POST /api/auth/reset-password", () => {
  it("never resets an admin from the merchant site, and spends no guess", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue(ADMIN);
    const res = await reset(ADMIN.email, "crypteo.io");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid or expired reset code" });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
  });

  it("answers an unknown address like a wrong code", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue(null);
    const res = await reset("nobody@example.com", "crypteo.io");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid or expired reset code" });
  });

  it("resets on the right host, revokes sessions and tells the owner", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue(MERCHANT);
    expect((await reset(MERCHANT.email, "crypteo.io")).status).toBe(200);
    expect(mock(prisma.merchant.update).mock.calls[0]?.[0].data).toMatchObject({
      password: "hashed",
      passwordChangedAt: expect.any(Date),
    });
    expect(notifyAccountSecurityChange).toHaveBeenCalledWith(
      expect.objectContaining({ to: MERCHANT.email, action: "Password reset", ip: "203.0.113.5" }),
    );
  });

  it("changes nothing on a wrong code", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue(MERCHANT);
    mock(verifyOtp).mockResolvedValue(false);
    expect((await reset(MERCHANT.email, "crypteo.io")).status).toBe(400);
    expect(prisma.merchant.update).not.toHaveBeenCalled();
    expect(notifyAccountSecurityChange).not.toHaveBeenCalled();
  });
});
