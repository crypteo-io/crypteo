import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/otp", () => ({
  generateOtp: vi.fn(() => "123456"),
  otpRecentlySent: vi.fn(async () => false),
}));
vi.mock("@/lib/mailer", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));

import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import { otpRecentlySent } from "@/lib/otp";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const resend = (body: string) =>
  POST(new NextRequest("https://app.example/api/auth/verify/resend", { method: "POST", body }));
const forEmail = JSON.stringify({ email: "owner@example.com" });

beforeEach(() => {
  vi.clearAllMocks();
  mock(otpRecentlySent).mockResolvedValue(false);
});

describe("POST /api/auth/verify/resend", () => {
  it("answers an unknown or verified account like a sent code, sending nothing", async () => {
    for (const merchant of [null, { emailVerified: new Date() }]) {
      mock(prisma.merchant.findUnique).mockResolvedValue(merchant);
      const res = await resend(forEmail);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends to an unverified account outside the cooldown", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({ emailVerified: null });
    expect((await resend(forEmail)).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("refuses within the cooldown", async () => {
    mock(otpRecentlySent).mockResolvedValue(true);
    expect((await resend(forEmail)).status).toBe(429);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("answers a malformed body with 400", async () => {
    expect((await resend("notjson")).status).toBe(400);
  });
});
