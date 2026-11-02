import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: {
    merchant: { findMany: vi.fn(), deleteMany: vi.fn() },
    otp: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));

import { prisma } from "./db";
import { purgeUnverifiedSignups } from "./otp";

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
