import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), rateLimitScoped: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock("@/lib/mailer", () => ({ transporter: { sendMail: vi.fn() } }));
vi.mock("@/lib/otp", () => ({ generateOtp: vi.fn(), otpRecentlySent: vi.fn(async () => false) }));

import { prisma } from "@/lib/db";
import { rateLimitScoped } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

function register(name: string, email = "new@example.com") {
  return POST(
    new NextRequest("https://app.example/api/auth/register/otp", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        password: "Str0ng-Pass!",
        turnstileToken: "t",
      }),
    }),
  );
}

describe("POST /api/auth/register/otp", () => {
  it.each(["Crypteo", "crypteo support", "Crypt3o", "Admin", "root", "User"])(
    "refuses the platform's name (%s) before touching the database",
    async (name) => {
      const res = await register(name);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/reserved for the platform/);
      expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/auth/register/otp email quality", () => {
  it("refuses a throwaway inbox before touching the database", async () => {
    const res = await register("Acme Store", "probe@mailinator.com");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "email", error: expect.stringMatching(/permanent email/) });
    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
  });

  it.each(["staff@crypteo.io", "x@admin.crypteo.io", "x@crypte-o.net"])(
    "refuses a platform-domain address (%s) before touching the database",
    async (email) => {
      const res = await register("Acme Store", email);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field: "email", error: expect.stringMatching(/platform's domain/) });
      expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
    },
  );

  it("caps new accounts per IP, but not a code resent to an unverified one", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    (rateLimitScoped as ReturnType<typeof vi.fn>).mockResolvedValue(NextResponse.json({}, { status: 429 }));
    expect((await register("Acme Store", "new@gmail.com")).status).toBe(429);
    expect(rateLimitScoped).toHaveBeenCalledWith(expect.anything(), "signup", 3, 86_400_000);

    (rateLimitScoped as ReturnType<typeof vi.fn>).mockClear();
    (prisma.merchant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m1", emailVerified: null });
    await register("Acme Store", "new@gmail.com");
    expect(rateLimitScoped).not.toHaveBeenCalled();
  });

  it("answers a malformed body with 400", async () => {
    const res = await POST(
      new NextRequest("https://app.example/api/auth/register/otp", { method: "POST", body: "notjson" }),
    );
    expect(res.status).toBe(400);
  });
});
