import { beforeEach, describe, expect, it, vi } from "vitest";
import { sourceFiles } from "./testing/source-files";

const { create, createMany, findMany } = vi.hoisted(() => ({
  create: vi.fn(async () => ({})),
  createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
  findMany: vi.fn(async () => [{ id: "admin1" }, { id: "admin2" }]),
}));
vi.mock("./db", () => ({
  prisma: { notification: { create, createMany }, merchant: { findMany } },
}));

import {
  ADMIN_KINDS,
  MERCHANT_KINDS,
  notifyAdmins,
  notifyMerchant,
  safeDashboardLink,
  type MerchantKind,
} from "./notifications";

const files = sourceFiles(["app", "lib", "workers", "scripts", "components"]);

beforeEach(() => vi.clearAllMocks());

/**
 * Operational alerts (orphans, failures, billing errors, holds placed) are for
 * admins only. A merchant's bell carries their own payments, fees and admin
 * messages, and never platform internals.
 */
describe("notification audiences never mix", () => {
  it("writes Notification rows only in lib/notifications.ts", () => {
    const writers = files
      .filter((f) => /\bnotification\.(create|createMany|upsert|update|updateMany)\s*\(/.test(f.text))
      .map((f) => f.path)
      .sort();
    // The read API only marks the caller's own rows read.
    expect(writers).toEqual(["app/api/notifications/route.ts", "lib/notifications.ts"]);
    const api = files.find((f) => f.path === "app/api/notifications/route.ts")!.text;
    expect(api).not.toMatch(/notification\.create/);
  });

  it("keeps merchant and admin kinds apart", () => {
    const overlap = MERCHANT_KINDS.filter((k) => (ADMIN_KINDS as readonly string[]).includes(k));
    expect(overlap).toEqual([]);
    expect(ADMIN_KINDS.every((k) => k.startsWith("admin_"))).toBe(true);
    expect(MERCHANT_KINDS.some((k) => k.startsWith("admin_") && k !== "admin_message")).toBe(false);
  });

  it("refuses an operational kind for a merchant", async () => {
    const ok = await notifyMerchant("m1", {
      kind: "admin_orphan" as unknown as MerchantKind,
      title: "Unmatched deposit",
      body: "internal",
    });
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends admin kinds to every active admin account", async () => {
    expect(await notifyAdmins({ kind: "admin_orphan", title: "t", body: "b" })).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "admin", isActive: true } }),
    );
  });

  it("never throws: a failed write must not fail what raised it", async () => {
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(
      notifyMerchant("m1", { kind: "payment_paid", title: "Paid", body: "b" }),
    ).resolves.toBe(false);
  });
});

describe("safeDashboardLink", () => {
  it("keeps a merchant's dashboard paths and drops everything else", () => {
    const m = (link: string) => safeDashboardLink(link, "merchant");
    expect(m("/dashboard/payments/abc123")).toBe("/dashboard/payments/abc123");
    expect(m("/dashboard/billing")).toBe("/dashboard/billing");
    expect(m("https://evil.example/dashboard")).toBeNull();
    expect(m("//evil.example/x")).toBeNull();
    expect(m("/dashboard//evil.example")).toBeNull();
    expect(m("javascript:alert(1)")).toBeNull();
    expect(m("/dashboard/../api/admin/merchants")).toBeNull();
    expect(m("/dashboardx")).toBeNull();
    expect(m("/merchants/abc")).toBeNull();
  });

  it("keeps admin-host pages for admins only", () => {
    const a = (link: string) => safeDashboardLink(link, "admin");
    expect(a("/merchants/abc123")).toBe("/merchants/abc123");
    expect(a("/contact?id=x1")).toBe("/contact?id=x1");
    expect(a("/revenue")).toBe("/revenue");
    expect(a("/dashboard/payments/x")).toBeNull();
    expect(a("/api/admin/merchants")).toBeNull();
    expect(a("/orphans/../api")).toBeNull();
  });
});
