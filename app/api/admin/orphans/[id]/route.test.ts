import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  orphanTransaction: { updateMany: vi.fn() },
  payment: { updateMany: vi.fn() },
  adminAuditLog: { create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    orphanTransaction: { findUnique: vi.fn() },
    payment: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    wallet: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/payment/notify", () => ({ triggerNotifications: vi.fn() }));
vi.mock("@/lib/admin", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin")>()),
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { triggerNotifications } from "@/lib/payment/notify";
import { POST } from "./route";

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;
const ORPHAN_ID = "corphan000000000000000001";
const PAYMENT_ID = "cpay00000000000000000001x";
const HOUR = 60 * 60 * 1000;

const orphan = (over: Record<string, unknown> = {}) => ({
  id: ORPHAN_ID,
  txHash: "0xfeed",
  walletAddress: "0xabc",
  chain: "eth",
  token: "usdt",
  receivedAmount: 100,
  blockTime: null,
  createdAt: new Date(Date.now() - 2 * HOUR),
  resolvedAt: null,
  ...over,
});
const payment = (over: Record<string, unknown> = {}) => ({
  id: PAYMENT_ID,
  merchantId: "m1",
  status: "expired",
  isTest: false,
  expiresAt: new Date(Date.now() - HOUR),
  walletAddress: "0xabc",
  chain: "eth",
  token: "usdt",
  expectedAmount: 100,
  receivedAmount: null,
  txHash: null,
  firstDetectedAt: null,
  confirmations: 0,
  merchant: { underpaidThreshold: 0.99 },
  ...over,
});

const credit = {
  action: "credit",
  paymentId: PAYMENT_ID,
  seen: { status: "expired", receivedAmount: null },
};

function post(body: unknown) {
  return POST(
    new NextRequest(`https://app.example/api/admin/orphans/${ORPHAN_ID}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ORPHAN_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(requireAdmin).mockResolvedValue({ admin: { id: "a1", email: "admin@x.co" } });
  mock(prisma.orphanTransaction.findUnique).mockResolvedValue(orphan());
  mock(prisma.payment.findUnique).mockImplementation(async ({ where }: { where: { id?: string } }) =>
    where.id ? payment() : null,
  );
  mock(prisma.payment.findUniqueOrThrow).mockResolvedValue(payment({ status: "confirmed" }));
  tx.orphanTransaction.updateMany.mockResolvedValue({ count: 1 });
  tx.payment.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/admin/orphans/[id] credit", () => {
  it("refuses non-admins", async () => {
    mock(requireAdmin).mockResolvedValue({
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    expect((await post(credit)).status).toBe(403);
    expect(prisma.orphanTransaction.findUnique).not.toHaveBeenCalled();
  });

  it("credits an expired session compare-and-set, records the hash, audits and notifies", async () => {
    const res = await post(credit);
    expect(res.status).toBe(200);
    expect(tx.orphanTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORPHAN_ID, resolvedAt: null } }),
    );
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, status: "expired", receivedAmount: null },
      data: expect.objectContaining({ status: "confirmed", receivedAmount: 100, txHash: "0xfeed" }),
    });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ merchantId: "m1", action: "creditOrphan" }),
    });
    expect(triggerNotifications).toHaveBeenCalled();
  });

  it("refuses a session the worker still watches, before writing anything", async () => {
    mock(prisma.payment.findUnique).mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? payment({ status: "pending", expiresAt: new Date(Date.now() + HOUR) }) : null,
    );
    const res = await post(credit);
    expect(res.status).toBe(409);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a transaction another session already holds", async () => {
    mock(prisma.payment.findUnique).mockImplementation(async ({ where }: { where: { id?: string; txHash?: string } }) =>
      where.txHash ? { id: "cother0000000000000000001" } : payment(),
    );
    const res = await post(credit);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("cother");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("never stores a synthetic or tie reference as the session's tx hash", async () => {
    mock(prisma.orphanTransaction.findUnique).mockResolvedValue(
      orphan({ txHash: "review:tie:eth:usdt:0xabc:100" }),
    );
    await post(credit);
    expect(tx.payment.updateMany.mock.calls[0][0].data).not.toHaveProperty("txHash");
  });

  it("refuses when the session differs from what the admin confirmed", async () => {
    // Found in the browser: a late deposit landed while the review page was
    // open, and the credit went through for a total the dialog never showed.
    mock(prisma.payment.findUnique).mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? payment({ status: "expired_received", receivedAmount: 12 }) : null,
    );
    const res = await post(credit);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed since you opened/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back and says so when the session changed underneath", async () => {
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    const res = await post(credit);
    expect(res.status).toBe(409);
    expect(triggerNotifications).not.toHaveBeenCalled();
  });

  it("refuses an orphan another admin resolved first", async () => {
    tx.orphanTransaction.updateMany.mockResolvedValue({ count: 0 });
    expect((await post(credit)).status).toBe(409);
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/orphans/[id] dismiss", () => {
  it("requires a reason", async () => {
    expect((await post({ action: "dismiss", notes: "" })).status).toBe(400);
  });

  it("dismisses with the reason and audits it against the wallet's merchant", async () => {
    mock(prisma.wallet.findFirst).mockResolvedValue({ merchantId: "m7" });
    const res = await post({ action: "dismiss", notes: "dust from a look-alike address" });
    expect(res.status).toBe(200);
    expect(tx.orphanTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: ORPHAN_ID, resolvedAt: null },
      data: expect.objectContaining({ notes: "dust from a look-alike address" }),
    });
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ merchantId: "m7", action: "dismissOrphan" }),
    });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});
