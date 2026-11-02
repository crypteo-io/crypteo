import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ prisma: { merchant: { findUnique: vi.fn() } } }));
vi.mock("./otp", () => ({ verifyOtp: vi.fn() }));
vi.mock("argon2", () => ({ verify: vi.fn() }));
vi.mock("./trusted-device", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trusted-device")>()),
  redeemLoginTicket: vi.fn(),
  trustDevice: vi.fn(),
}));
vi.mock("next-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-auth")>()),
  getServerSession: vi.fn(),
}));

import { verify } from "argon2";
import { getServerSession } from "next-auth";
import { auth, authOptions } from "./auth";
import { prisma } from "./db";
import { verifyOtp } from "./otp";
import { DEVICE_COOKIE, ensureDeviceToken, redeemLoginTicket, trustDevice } from "./trusted-device";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
type Authorize = (
  c: Record<string, string | undefined>,
  req: { headers: Record<string, string> },
) => Promise<unknown>;
const authorizeOn =
  (host: string, headers: Record<string, string> = {}) => (c: Record<string, string | undefined>) =>
    (authOptions.providers[0] as unknown as { options: { authorize: Authorize } }).options.authorize(c, {
      headers: { host, ...headers },
    });
const authorize = authorizeOn("crypteo.io");

const merchant = {
  id: "m1",
  email: "owner@example.com",
  name: "Owner",
  role: "merchant",
  emailVerified: new Date(),
  isActive: true,
  password: "hash",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
  mock(prisma.merchant.findUnique).mockResolvedValue(merchant);
});

describe("credentials authorize (step two of login)", () => {
  it("demands the OTP before ever checking the password", async () => {
    await expect(
      authorize({ email: "owner@example.com", password: "guess" }),
    ).rejects.toThrow("OTPRequired");
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a wrong OTP without revealing whether the password is right", async () => {
    mock(verifyOtp).mockResolvedValue(false);
    mock(verify).mockResolvedValue(true);
    await expect(
      authorize({ email: "owner@example.com", password: "right", otp: "000000" }),
    ).rejects.toThrow("InvalidOTP");
    expect(verify).not.toHaveBeenCalled();
  });

  it("signs in with a valid OTP and password, without a second captcha", async () => {
    mock(verifyOtp).mockResolvedValue(true);
    mock(verify).mockResolvedValue(true);
    const user = await authorize({
      email: "Owner@Example.com",
      password: "right",
      otp: "123456",
    });
    expect(user).toMatchObject({ id: "m1" });
    expect(verifyOtp).toHaveBeenCalledWith("owner@example.com", "123456", "LOGIN");
  });

  it("still refuses a wrong password after a valid OTP", async () => {
    mock(verifyOtp).mockResolvedValue(true);
    mock(verify).mockResolvedValue(false);
    expect(
      await authorize({ email: "owner@example.com", password: "x", otp: "123456" }),
    ).toBeNull();
  });

  it("signs an admin in on the admin host only", async () => {
    mock(verifyOtp).mockResolvedValue(true);
    mock(verify).mockResolvedValue(true);
    mock(prisma.merchant.findUnique).mockResolvedValue({ ...merchant, role: "admin" });
    const creds = { email: "owner@example.com", password: "right", otp: "123456" };
    expect(await authorize(creds)).toBeNull();
    expect(await authorizeOn("admin.crypteo.io")(creds)).toMatchObject({ role: "admin" });
  });

  it("never signs a merchant in on the admin host", async () => {
    mock(verifyOtp).mockResolvedValue(true);
    mock(verify).mockResolvedValue(true);
    expect(
      await authorizeOn("admin.crypteo.io")({ email: "owner@example.com", password: "right", otp: "123456" }),
    ).toBeNull();
  });
});

describe("trusted devices in authorize", () => {
  const device = ensureDeviceToken(null).token;
  const fromDevice = authorizeOn("crypteo.io", {
    cookie: `${DEVICE_COOKIE}=${device}`,
    "cf-ipcountry": "GB",
  });

  it("signs a remembered browser in with step one's ticket instead of a code", async () => {
    mock(redeemLoginTicket).mockResolvedValue(true);
    mock(verify).mockResolvedValue(true);
    const user = await fromDevice({ email: "owner@example.com", password: "right", ticket: "t" });
    expect(user).toMatchObject({ id: "m1" });
    expect(redeemLoginTicket).toHaveBeenCalledWith("owner@example.com", "t", device);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("refuses a spent or foreign ticket before checking the password", async () => {
    mock(redeemLoginTicket).mockResolvedValue(false);
    await expect(
      fromDevice({ email: "owner@example.com", password: "guess", ticket: "t" }),
    ).rejects.toThrow("LoginExpired");
    expect(verify).not.toHaveBeenCalled();
  });

  it("remembers the browser only when asked, after a code", async () => {
    mock(verifyOtp).mockResolvedValue(true);
    mock(verify).mockResolvedValue(true);
    await fromDevice({ email: "owner@example.com", password: "right", otp: "123456", trustDevice: "false" });
    expect(trustDevice).not.toHaveBeenCalled();
    await fromDevice({ email: "owner@example.com", password: "right", otp: "123456", trustDevice: "true" });
    expect(trustDevice).toHaveBeenCalledWith("m1", device, "GB");
  });

  it("never remembers a browser after a wrong password", async () => {
    mock(verifyOtp).mockResolvedValue(true);
    mock(verify).mockResolvedValue(false);
    await fromDevice({ email: "owner@example.com", password: "x", otp: "123456", trustDevice: "true" });
    expect(trustDevice).not.toHaveBeenCalled();
  });
});

describe("session re-validation", () => {
  type Jwt = (p: { token: Record<string, unknown> }) => Promise<unknown>;
  const jwt = authOptions.callbacks!.jwt as unknown as Jwt;
  const token = { id: "m1", role: "merchant", authTime: 1_000, checkedAt: 0 };

  it("revokes a session opened before an admin's sign-out-everywhere", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      ...merchant,
      passwordChangedAt: null,
      sessionsRevokedAt: new Date(2_000),
    });
    await expect(jwt({ token })).rejects.toThrow("SessionRevoked");
  });

  it("keeps a session opened after it", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      ...merchant,
      passwordChangedAt: null,
      sessionsRevokedAt: new Date(500),
    });
    await expect(jwt({ token })).resolves.toMatchObject({ id: "m1" });
  });
});

// The JWT is only re-checked every 5 minutes; a suspended (or deleted)
// merchant must lose the dashboard and API on the very next request.
describe("auth() checks account status on every request", () => {
  const session = { user: { id: "m1", role: "merchant" } };

  it("returns the session for an active account", async () => {
    mock(getServerSession).mockResolvedValue(session);
    mock(prisma.merchant.findUnique).mockResolvedValue({ isActive: true });
    expect(await auth()).toBe(session);
  });

  it("returns null as soon as the account is suspended", async () => {
    mock(getServerSession).mockResolvedValue(session);
    mock(prisma.merchant.findUnique).mockResolvedValue({ isActive: false });
    expect(await auth()).toBeNull();
  });

  it("returns null for a deleted account", async () => {
    mock(getServerSession).mockResolvedValue(session);
    mock(prisma.merchant.findUnique).mockResolvedValue(null);
    expect(await auth()).toBeNull();
  });

  it("doesn't query for a signed-out request", async () => {
    mock(getServerSession).mockResolvedValue(null);
    expect(await auth()).toBeNull();
    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
  });
});
