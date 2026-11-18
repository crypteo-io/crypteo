import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: {
    merchant: { findMany: vi.fn(), deleteMany: vi.fn() },
    otp: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));

import { prisma } from "./db";
import { generateOtp, otpDigest, purgeExpiredOtps, purgeUnverifiedSignups, verifyOtp } from "./otp";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("purgeUnverifiedSignups", () => {
  it("only considers week-old, untouched, live merchant sign-ups", async () => {
    mock(prisma.merchant.findMany).mockResolvedValue([]);
    const now = new Date("2026-11-10T00:00:00Z");
    expect(await purgeUnverifiedSignups(now)).toBe(0);
    const where = mock(prisma.merchant.findMany).mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      emailVerified: null,
      isActive: true,
      role: "merchant",
      createdAt: { lt: new Date("2026-11-03T00:00:00Z") },
      NOT: { email: { endsWith: "@deleted.invalid" } },
      payments: { none: {} },
      wallets: { none: {} },
    });
    expect(prisma.merchant.deleteMany).not.toHaveBeenCalled();
  });

  it("removes them with their codes, re-checking they are still unverified", async () => {
    mock(prisma.merchant.findMany).mockResolvedValue([{ id: "m1", email: "x@crypteo.io" }]);
    mock(prisma.otp.deleteMany).mockResolvedValue({ count: 1 });
    mock(prisma.merchant.deleteMany).mockResolvedValue({ count: 1 });
    expect(await purgeUnverifiedSignups()).toBe(1);
    expect(prisma.otp.deleteMany).toHaveBeenCalledWith({ where: { email: { in: ["x@crypteo.io"] } } });
    expect(prisma.merchant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["m1"] }, emailVerified: null } });
  });
});

describe("verifyOtp spends each guess before checking it (pen-test 2026-11-15)", () => {
  const row = { id: "o1", code: otpDigest("123456"), attempts: 4 };
  const otp = prisma.otp as unknown as Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    otp.findFirst = vi.fn(async () => row);
    otp.updateMany = vi.fn(async () => ({ count: 1 }));
    otp.deleteMany = vi.fn(async () => ({ count: 1 }));
  });

  it("refuses even the right code once a parallel request took the last guess", async () => {
    otp.updateMany.mockResolvedValue({ count: 0 });
    expect(await verifyOtp("a@b.co", "123456", "LOGIN")).toBe(false);
    expect(otp.updateMany).toHaveBeenCalledWith({
      where: { id: "o1", attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
  });

  it("counts a wrong guess and only deletes the code once its guesses are spent", async () => {
    expect(await verifyOtp("a@b.co", "000000", "LOGIN")).toBe(false);
    expect(otp.deleteMany).toHaveBeenCalledTimes(1);
    expect(otp.deleteMany).toHaveBeenCalledWith({ where: { id: "o1", attempts: { gte: 5 } } });
  });

  it("accepts the right code once: a second request that loses the delete is refused", async () => {
    expect(await verifyOtp("a@b.co", "123456", "LOGIN")).toBe(true);
    otp.deleteMany.mockResolvedValue({ count: 0 });
    expect(await verifyOtp("a@b.co", "123456", "LOGIN")).toBe(false);
  });
});

describe("codes are stored as digests and thrown away (2026-11-15)", () => {
  const otp = prisma.otp as unknown as Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    otp.findFirst = vi.fn(async () => null);
    otp.updateMany = vi.fn(async () => ({ count: 1 }));
    otp.deleteMany = vi.fn(async () => ({ count: 1 }));
    otp.create = vi.fn(async () => ({}));
  });

  it("stores the code's HMAC, never the code", async () => {
    const code = await generateOtp("a@b.co", "PASSWORD_RESET");
    const stored = otp.create.mock.calls[0]?.[0].data.code;
    expect(stored).not.toContain(code);
    expect(stored).toBe(otpDigest(code));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws an expired code away when it is next asked about", async () => {
    expect(await verifyOtp("a@b.co", "123456", "LOGIN")).toBe(false);
    expect(otp.deleteMany).toHaveBeenCalledWith({
      where: { email: "a@b.co", type: "LOGIN", expiresAt: { lte: expect.any(Date) } },
    });
  });

  it("throws the code away on the last allowed wrong guess", async () => {
    otp.findFirst.mockResolvedValue({ id: "o1", code: otpDigest("123456"), attempts: 4 });
    expect(await verifyOtp("a@b.co", "000000", "LOGIN")).toBe(false);
    expect(otp.deleteMany).toHaveBeenCalledWith({ where: { id: "o1", attempts: { gte: 5 } } });
  });

  it("purges every expired code", async () => {
    otp.deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date("2026-11-15T15:00:00Z");
    expect(await purgeExpiredOtps(now)).toBe(3);
    expect(otp.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } });
  });
});
