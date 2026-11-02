import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { merchant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/otp", async (orig) => ({
  ...(await orig<typeof import("@/lib/otp")>()),
  generateOtp: vi.fn(() => "123456"),
}));
vi.mock("@/lib/mailer", () => ({ sendEmailToEach: vi.fn(async () => 1) }));
vi.mock("argon2", () => ({ verify: vi.fn(() => true) }));
vi.mock("@/lib/trusted-device", async (orig) => ({
  ...(await orig<typeof import("@/lib/trusted-device")>()),
  isTrustedLogin: vi.fn(async () => false),
  issueLoginTicket: vi.fn(async () => "ticket"),
}));

import { prisma } from "@/lib/db";
import { sendEmailToEach } from "@/lib/mailer";
import { generateOtp } from "@/lib/otp";
import { DEVICE_COOKIE, ensureDeviceToken, isTrustedLogin } from "@/lib/trusted-device";
import { verifyTurnstile } from "@/lib/turnstile";
import { verify } from "argon2";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

const SITE = "crypteo.io";
const ADMIN_HOST = "admin.crypteo.io";

function login(body: Record<string, unknown>, host = SITE, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(`https://${host}/api/auth/login/otp`, {
      method: "POST",
      headers: { host, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const creds = { email: "owner@example.com", password: "pw" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
  mock(prisma.merchant.findUnique).mockResolvedValue({
    email: "owner@example.com",
    password: "hash",
    role: "merchant",
    isActive: true,
    emailVerified: new Date(),
    twoFactorMethod: "email",
    totpSecret: null,
  });
});

describe("POST /api/auth/login/otp captcha", () => {
  it("refuses a missing token before touching the account", async () => {
    const res = await login(creds);
    expect(res.status).toBe(400);
    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses an invalid token", async () => {
    mock(verifyTurnstile).mockResolvedValue(false);
    const res = await login({ ...creds, turnstileToken: "bad" });
    expect(res.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });

  it("checks the password once the captcha passes", async () => {
    mock(verifyTurnstile).mockResolvedValue(true);
    const res = await login({ ...creds, turnstileToken: "good" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ otpRequired: true, method: "email" });
    expect(verifyTurnstile).toHaveBeenCalledWith("good");
  });

  it("logs loudly but does not lock out when production has no secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await login(creds);
    expect(res.status).toBe(200);
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(err.mock.calls.some((c) => String(c[0]).includes("TURNSTILE_SECRET_KEY"))).toBe(true);
    err.mockRestore();
  });

  it("does not require a captcha outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await login(creds);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/login/otp second factor", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "development"));

  it("emails a merchant's code to their own address only", async () => {
    vi.stubEnv("ADMIN_OTP_COPY_EMAILS", "ops@example.com");
    await login(creds);
    expect(sendEmailToEach).toHaveBeenCalledWith(["owner@example.com"], expect.anything());
  });

  it("copies an admin's code to every ADMIN_OTP_COPY_EMAILS address", async () => {
    vi.stubEnv("ADMIN_OTP_COPY_EMAILS", "ops@example.com, Backup@Example.com");
    mock(prisma.merchant.findUnique).mockResolvedValue({
      email: "owner@example.com",
      password: "hash",
      role: "admin",
      isActive: true,
      emailVerified: new Date(),
      twoFactorMethod: "email",
      totpSecret: null,
    });
    const res = await login(creds, ADMIN_HOST);
    expect(await res.json()).toEqual({ otpRequired: true, method: "email" });
    expect(sendEmailToEach).toHaveBeenCalledWith(
      ["owner@example.com", "ops@example.com", "backup@example.com"],
      expect.anything(),
    );
  });

  it("asks an authenticator account for its app code and sends no email", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      email: "owner@example.com",
      password: "hash",
      role: "admin",
      isActive: true,
      emailVerified: new Date(),
      twoFactorMethod: "totp",
      totpSecret: "v1:enc",
    });
    const res = await login(creds, ADMIN_HOST);
    expect(await res.json()).toEqual({ otpRequired: true, method: "totp" });
    // The LOGIN challenge still exists: step two spends it.
    expect(generateOtp).toHaveBeenCalledWith("owner@example.com", "LOGIN");
    expect(sendEmailToEach).not.toHaveBeenCalled();
  });

describe("POST /api/auth/login/otp host", () => {
  const account = (role: string) => ({
    email: "owner@example.com",
    password: "hash",
    role,
    isActive: true,
    emailVerified: new Date(),
    twoFactorMethod: "email",
    totpSecret: null,
  });

  it("sends an admin to the admin host and a merchant to the site, sending no code", async () => {
    mock(verify).mockResolvedValue(true);
    mock(verifyTurnstile).mockResolvedValue(true);
    mock(prisma.merchant.findUnique).mockResolvedValue(account("admin"));
    const admin = await login(creds);
    expect(admin.status).toBe(403);
    expect((await admin.json()).error).toContain("admin.crypteo.io");

    mock(prisma.merchant.findUnique).mockResolvedValue(account("merchant"));
    const merchant = await login(creds, ADMIN_HOST);
    expect(merchant.status).toBe(403);
    expect(sendEmailToEach).not.toHaveBeenCalled();
  });
});
});

describe("POST /api/auth/login/otp on a remembered browser", () => {
  beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
  const device = ensureDeviceToken(null).token;
  const fromDevice = { cookie: `${DEVICE_COOKIE}=${device}`, "cf-ipcountry": "GB" };
  beforeEach(() => mock(isTrustedLogin).mockResolvedValue(false));

  it("hands back a ticket and sends no code", async () => {
    mock(isTrustedLogin).mockResolvedValue(true);
    const res = await login(creds, SITE, fromDevice);
    expect(await res.json()).toEqual({ otpRequired: false, ticket: "ticket" });
    expect(isTrustedLogin).toHaveBeenCalledWith(expect.objectContaining({ email: "owner@example.com" }), device, "GB");
    expect(generateOtp).not.toHaveBeenCalled();
    expect(sendEmailToEach).not.toHaveBeenCalled();
  });

  it("emails a code when the login is suspicious", async () => {
    const res = await login(creds, SITE, fromDevice);
    expect(await res.json()).toEqual({ otpRequired: true, method: "email" });
    expect(sendEmailToEach).toHaveBeenCalled();
    expect(res.cookies.get(DEVICE_COOKIE)).toBeUndefined();
  });

  it("gives a browser without a device id one, and asks for a code", async () => {
    const res = await login(creds);
    expect(await res.json()).toEqual({ otpRequired: true, method: "email" });
    expect(isTrustedLogin).not.toHaveBeenCalled();
    expect(res.cookies.get(DEVICE_COOKIE)?.httpOnly).toBe(true);
  });

  it("never checks a device before the password", async () => {
    mock(verify).mockResolvedValueOnce(false);
    const res = await login(creds, SITE, fromDevice);
    expect(res.status).toBe(401);
    expect(isTrustedLogin).not.toHaveBeenCalled();
  });
});
