import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  merchant: { findUnique: vi.fn(), updateMany: vi.fn() },
  accountRiskEvent: { create: vi.fn(), findMany: vi.fn() },
  notification: { findFirst: vi.fn() },
  adminAuditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("./db", () => ({ prisma: db }));
vi.mock("./mailer", () => ({ notifyAccountSuspended: vi.fn(async () => {}) }));
vi.mock("./admin-alerts", () => ({ sendAdminAlert: vi.fn(async () => true) }));
vi.mock("./notifications", () => ({ notifyAdmins: vi.fn(async () => {}) }));

import { sendAdminAlert } from "./admin-alerts";
import { noteForeignRecord, recordRiskEvent, riskDecision } from "./account-risk";
import { notifyAccountSuspended } from "./mailer";

const MERCHANT = { name: "Probe Co", email: "sqli7@example.com", role: "merchant", isActive: true };
const event = () => ({ kind: "probe_request", detail: "x", createdAt: new Date() });

beforeEach(() => {
  vi.clearAllMocks();
  db.merchant.findUnique.mockResolvedValue(MERCHANT);
  db.merchant.updateMany.mockResolvedValue({ count: 1 });
  db.notification.findFirst.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("riskDecision", () => {
  it("suspends a merchant on a certain probe, whatever its sales; only flags an admin", () => {
    expect(riskDecision({ role: "merchant", kind: "probe_request", foreignRecords: 0 })).toBe("suspend");
    expect(riskDecision({ role: "merchant", kind: "probe_input", foreignRecords: 0 })).toBe("suspend");
    expect(riskDecision({ role: "admin", kind: "probe_request", foreignRecords: 0 })).toBe("flag");
  });

  it("never suspends on a stale tab: other merchants' records need three distinct ones in a day", () => {
    expect(riskDecision({ role: "merchant", kind: "foreign_record", foreignRecords: 1 })).toBe("none");
    expect(riskDecision({ role: "merchant", kind: "foreign_record", foreignRecords: 2 })).toBe("none");
    expect(riskDecision({ role: "merchant", kind: "foreign_record", foreignRecords: 3 })).toBe("suspend");
  });
});

describe("recordRiskEvent (any probe suspends, user 2026-11-16)", () => {
  beforeEach(() => db.accountRiskEvent.findMany.mockResolvedValue([event()]));

  it("suspends on the first probe, signs the merchant out everywhere, and tells them and admins", async () => {
    await recordRiskEvent("m1", "probe_request", "SQL injection: GET /api/payments?search=pg_sleep(6)");
    expect(db.accountRiskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ merchantId: "m1", kind: "probe_request" }),
    });
    expect(db.merchant.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", isActive: true },
      data: expect.objectContaining({
        isActive: false,
        suspensionReason: "automatic",
        sessionsRevokedAt: expect.any(Date),
      }),
    });
    expect(db.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ adminId: "system", action: "autoSuspend", merchantId: "m1" }),
    });
    expect(notifyAccountSuspended).toHaveBeenCalledWith(expect.objectContaining({ to: MERCHANT.email }));
    expect(sendAdminAlert).toHaveBeenCalled();
  });

  it("emails nobody when another request already suspended the account", async () => {
    db.merchant.updateMany.mockResolvedValue({ count: 0 });
    await recordRiskEvent("m1", "probe_request", "x");
    expect(notifyAccountSuspended).not.toHaveBeenCalled();
    expect(db.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("never suspends an admin account, only alerts other admins", async () => {
    db.merchant.findUnique.mockResolvedValue({ ...MERCHANT, role: "admin" });
    await recordRiskEvent("m1", "probe_input", "x");
    expect(db.merchant.updateMany).not.toHaveBeenCalled();
    expect(sendAdminAlert).toHaveBeenCalled();
  });

  it("ignores a suspended account and never throws", async () => {
    db.merchant.findUnique.mockResolvedValue({ ...MERCHANT, isActive: false });
    await recordRiskEvent("m1", "probe_input", "x");
    expect(db.accountRiskEvent.create).not.toHaveBeenCalled();
    db.merchant.findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordRiskEvent("m1", "probe_input", "x")).resolves.toBeUndefined();
  });
});

describe("noteForeignRecord", () => {
  it("counts only another account's existing record", async () => {
    db.accountRiskEvent.findMany.mockResolvedValue([]);
    await noteForeignRecord("m1", "payment link", null);
    await noteForeignRecord("m1", "payment link", { id: "l1", merchantId: "m1" });
    expect(db.accountRiskEvent.create).not.toHaveBeenCalled();
  });

  it("records the same stale record without suspending, and suspends at three distinct ones", async () => {
    const foreign = (id: string) => ({ kind: "foreign_record", detail: `payment link ${id}`, createdAt: new Date() });
    db.accountRiskEvent.findMany.mockResolvedValue([foreign("l2"), foreign("l2"), foreign("l2")]);
    await noteForeignRecord("m1", "payment link", { id: "l2", merchantId: "m2" });
    expect(db.accountRiskEvent.create).toHaveBeenCalled();
    expect(db.merchant.updateMany).not.toHaveBeenCalled();

    db.accountRiskEvent.findMany.mockResolvedValue([foreign("l2"), foreign("l3"), foreign("l4")]);
    await noteForeignRecord("m1", "payment link", { id: "l4", merchantId: "m2" });
    expect(db.merchant.updateMany).toHaveBeenCalled();
  });
});
