import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ auth: vi.fn() }));
vi.mock("./db", () => ({ prisma: { merchant: { findUnique: vi.fn(), count: vi.fn() } } }));

import { refuseAdminAction, requireAdmin, wouldRemoveLastAdmin } from "./admin";
import { auth } from "./auth";
import { prisma } from "./db";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => vi.resetAllMocks());

describe("requireAdmin re-reads the role instead of trusting the session", () => {
  it("refuses a signed-out request", async () => {
    mock(auth).mockResolvedValue(null);
    expect((await requireAdmin()).response?.status).toBe(401);
  });

  it("refuses an admin demoted since their session was issued", async () => {
    mock(auth).mockResolvedValue({ user: { id: "a1", role: "admin" } });
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: "a1",
      email: "a@x.co",
      role: "merchant",
      isActive: true,
    });
    expect((await requireAdmin()).response?.status).toBe(403);
  });

  it("refuses a suspended admin", async () => {
    mock(auth).mockResolvedValue({ user: { id: "a1", role: "admin" } });
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: "a1",
      email: "a@x.co",
      role: "admin",
      isActive: false,
    });
    expect((await requireAdmin()).response?.status).toBe(403);
  });

  it("returns the admin it read", async () => {
    mock(auth).mockResolvedValue({ user: { id: "a1", role: "admin" } });
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: "a1",
      email: "a@x.co",
      role: "admin",
      isActive: true,
    });
    expect(await requireAdmin()).toEqual({ admin: { id: "a1", email: "a@x.co" } });
  });
});

describe("wouldRemoveLastAdmin", () => {
  it("counts only other active admins", async () => {
    mock(prisma.merchant.count).mockResolvedValue(0);
    expect(await wouldRemoveLastAdmin("a1")).toBe(true);
    expect(prisma.merchant.count).toHaveBeenCalledWith({
      where: { role: "admin", isActive: true, id: { not: "a1" } },
    });
  });
});

describe("refuseAdminAction never leaves the platform without an admin", () => {
  const admin = { id: "a2", email: "b@x.co", role: "admin" };
  const merchant = { id: "m1", email: "m@x.co", role: "merchant" };
  const suspend = { action: "setActive", isActive: false };
  const demote = { action: "setRole", role: "merchant" };

  it.each([
    ["suspend", suspend],
    ["demote", demote],
  ])("refuses to %s the last active admin", (_name, action) => {
    expect(
      refuseAdminAction({ actorId: "a1", target: admin, action, isLastAdmin: true }),
    ).toMatch(/last active admin/);
  });

  it.each([
    ["suspend", suspend],
    ["demote", demote],
  ])("refuses to let an admin %s themselves", (_name, action) => {
    expect(
      refuseAdminAction({ actorId: "a2", target: admin, action, isLastAdmin: false }),
    ).toMatch(/your own account/);
  });

  it("allows suspending another admin while one remains", () => {
    expect(
      refuseAdminAction({ actorId: "a1", target: admin, action: suspend, isLastAdmin: false }),
    ).toBeNull();
  });

  it("allows every action on a merchant", () => {
    for (const action of [suspend, demote, { action: "resetPassword" }, { action: "setRole", role: "admin" }]) {
      expect(
        refuseAdminAction({ actorId: "a1", target: merchant, action, isLastAdmin: true }),
        action.action,
      ).toBeNull();
    }
  });

  it("refuses any change to a deleted account (it can't be revived)", () => {
    expect(
      refuseAdminAction({
        actorId: "a1",
        target: { id: "m2", email: "deleted+m2@deleted.invalid", role: "merchant" },
        action: { action: "setActive", isActive: true },
        isLastAdmin: false,
      }),
    ).toMatch(/Deleted/);
  });
});
