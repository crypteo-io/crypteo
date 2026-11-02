import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  merchant: { update: vi.fn(), updateMany: vi.fn() },
  apiKey: { updateMany: vi.fn() },
  wallet: { updateMany: vi.fn() },
  paymentLink: { updateMany: vi.fn() },
  adminAuditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    merchant: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(), clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/mailer", () => ({ notifyAccountSecurityChange: vi.fn() }));
vi.mock("@/lib/admin-grant", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-grant")>()),
  confirmsOwnPassword: vi.fn(),
  announceAdminGrant: vi.fn(),
}));
vi.mock("argon2", () => ({ hash: vi.fn(async () => "hashed") }));
vi.mock("@/lib/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin")>()),
  requireAdmin: vi.fn(),
  wouldRemoveLastAdmin: vi.fn(),
  softDeleteMerchantOps: vi.fn(async () => []),
}));

import { requireAdmin, wouldRemoveLastAdmin } from "@/lib/admin";
import { announceAdminGrant, confirmsOwnPassword } from "@/lib/admin-grant";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { NextResponse } from "next/server";
import { DELETE, PATCH } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ID = "cmn8p2oee0000zyx0hfekxjlq";
const ADMIN = { id: "cadmin0000000000000000001", email: "admin@x.co" };

function patch(body: unknown, id = ID) {
  return PATCH(
    new NextRequest(`https://app.example/api/admin/merchants/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function del(id = ID) {
  return DELETE(new NextRequest(`https://app.example/api/admin/merchants/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mock(requireAdmin).mockResolvedValue({ admin: ADMIN });
  mock(wouldRemoveLastAdmin).mockResolvedValue(false);
  mock(prisma.merchant.findUnique).mockResolvedValue({
    id: ID,
    name: "Shop",
    email: "shop@x.co",
    role: "merchant",
    isActive: true,
    emailVerified: new Date(),
  });
  mock(prisma.$transaction).mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(tx) : arg,
  );
  for (const m of [tx.apiKey, tx.wallet, tx.paymentLink]) m.updateMany.mockResolvedValue({ count: 1 });
});

describe("PATCH /api/admin/merchants/[id]", () => {
  it("refuses a non-admin before reading anything", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await patch({ action: "setActive", isActive: false });
    expect(res.status).toBe(403);
    expect(prisma.merchant.findUnique).not.toHaveBeenCalled();
  });

  it("suspends, records who did it, and tells the merchant", async () => {
    const res = await patch({ action: "setActive", isActive: false });
    expect(res.status).toBe(200);
    expect(tx.merchant.update).toHaveBeenCalledWith({ where: { id: ID }, data: { isActive: false } });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        adminId: ADMIN.id,
        adminEmail: ADMIN.email,
        merchantId: ID,
        action: "setActive",
        details: { isActive: false },
      },
    });
    expect(notifyAccountSecurityChange).toHaveBeenCalledWith(
      expect.objectContaining({ to: "shop@x.co", action: "Account suspended" }),
    );
  });

  it("NEVER writes a reset password into the audit trail", async () => {
    const res = await patch({ action: "resetPassword", newPassword: "N3w-Passw0rd!" });
    expect(res.status).toBe(200);
    expect(tx.merchant.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { password: "hashed", passwordChangedAt: expect.any(Date) },
    });
    expect(JSON.stringify(tx.adminAuditLog.create.mock.calls)).not.toContain("N3w-Passw0rd!");
  });

  it("refuses a reserved name for a merchant", async () => {
    expect((await patch({ action: "updateProfile", name: "Root" })).status).toBe(400);
    expect(tx.merchant.update).not.toHaveBeenCalled();
  });

  it("lets an admin account be named for the platform, and not be demoted with it", async () => {
    const admin = { id: ID, name: "Ops", email: "ops@x.co", role: "admin", isActive: true, emailVerified: new Date() };
    mock(prisma.merchant.findUnique).mockResolvedValue(admin);
    expect((await patch({ action: "updateProfile", name: "Admin" })).status).toBe(200);
    mock(prisma.merchant.findUnique).mockResolvedValue({ ...admin, name: "Crypteo" });
    const demote = await patch({ action: "setRole", role: "merchant" });
    expect(demote.status).toBe(400);
    expect((await demote.json()).error).toMatch(/Rename this account/);
  });

  it("refuses a platform-domain email for a merchant, and won't verify one", async () => {
    expect((await patch({ action: "updateProfile", email: "staff@crypteo.io" })).status).toBe(400);
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: ID, name: "Shop", email: "x@crypteo.io", role: "merchant", isActive: true, emailVerified: null,
    });
    const verify = await patch({ action: "verifyEmail" });
    expect(verify.status).toBe(400);
    expect((await verify.json()).error).toMatch(/platform's domain/);
    expect(tx.merchant.update).not.toHaveBeenCalled();
    expect(tx.merchant.updateMany).not.toHaveBeenCalled();
  });

  it("grants admin only with the acting admin's password, and tells every admin", async () => {
    mock(confirmsOwnPassword).mockResolvedValue(false);
    const refused = await patch({ action: "setRole", role: "admin", password: "wrong" });
    expect(refused.status).toBe(403);
    expect(confirmsOwnPassword).toHaveBeenCalledWith(ADMIN.id, "wrong");
    expect(tx.merchant.update).not.toHaveBeenCalled();
    expect(announceAdminGrant).not.toHaveBeenCalled();

    mock(confirmsOwnPassword).mockResolvedValue(true);
    const res = await patch({ action: "setRole", role: "admin", password: "R1ght-Pass!" });
    expect(res.status).toBe(200);
    expect(tx.merchant.update).toHaveBeenCalledWith({ where: { id: ID }, data: { role: "admin" } });
    expect(announceAdminGrant).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ID, accountEmail: "shop@x.co", grantedBy: ADMIN.email }),
    );
    expect(JSON.stringify(tx.adminAuditLog.create.mock.calls)).not.toContain("R1ght-Pass!");
  });

  it("refuses a weak password", async () => {
    expect((await patch({ action: "resetPassword", newPassword: "short" })).status).toBe(400);
    expect(tx.merchant.update).not.toHaveBeenCalled();
  });

  it("refuses to demote the last active admin", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: ID,
      name: "Other admin",
      email: "o@x.co",
      role: "admin",
      isActive: true,
      emailVerified: new Date(),
    });
    mock(wouldRemoveLastAdmin).mockResolvedValue(true);
    const res = await patch({ action: "setRole", role: "merchant" });
    expect(res.status).toBe(409);
    expect(tx.merchant.update).not.toHaveBeenCalled();
  });

  it("only touches an API key that belongs to this merchant", async () => {
    tx.apiKey.updateMany.mockResolvedValue({ count: 0 });
    const keyId = "ckey00000000000000000000001";
    const res = await patch({ action: "setApiKeyActive", keyId, isActive: false });
    expect(res.status).toBe(404);
    expect(tx.apiKey.updateMany).toHaveBeenCalledWith({
      where: { id: keyId, merchantId: ID },
      data: { isActive: false },
    });
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("resets two-factor back to email codes", async () => {
    await patch({ action: "resetTwoFactor" });
    expect(tx.merchant.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: {
        twoFactorMethod: "email",
        totpSecret: null,
        totpPendingSecret: null,
        totpLastUsedStep: null,
      },
    });
  });

  it("rejects an unknown action and a malformed id", async () => {
    expect((await patch({ action: "makeRich" })).status).toBe(400);
    expect((await patch({ action: "verifyEmail" }, "../etc")).status).toBe(400);
  });
});

describe("DELETE /api/admin/merchants/[id]", () => {
  it("refuses to delete the signed-in admin's own account here", async () => {
    mock(prisma.merchant.findUnique).mockResolvedValue({
      id: ADMIN.id,
      name: "Admin",
      email: ADMIN.email,
      role: "admin",
      isActive: true,
      emailVerified: new Date(),
    });
    expect((await del(ADMIN.id)).status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("soft-deletes a merchant and audits it in the same transaction", async () => {
    mock(prisma.adminAuditLog.create).mockReturnValue("audit-op");
    const res = await del();
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledWith(["audit-op"]);
  });
});
