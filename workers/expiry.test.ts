import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  prisma: {
    payment: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("../lib/payment/notify", () => ({ triggerNotifications: vi.fn() }));

import { prisma } from "../lib/db";
import { triggerNotifications } from "../lib/payment/notify";
import { expireStalePending, timeoutStaleConfirming } from "./expiry";

const findMany = prisma.payment.findMany as unknown as ReturnType<typeof vi.fn>;
const updateMany = prisma.payment.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const findUnique = prisma.payment.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const notify = triggerNotifications as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  findMany.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  findUnique
    .mockReset()
    .mockImplementation(async ({ where }) => ({ id: where.id, status: "x" }));
  notify.mockReset().mockResolvedValue(undefined);
});

describe("expireStalePending", () => {
  it("expires each stale pending row with a status guard and notifies it", async () => {
    findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);

    const moved = await expireStalePending(new Date("2026-09-30T12:00:00Z"));

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      status: "pending",
      isTest: false,
      expiresAt: { lte: new Date("2026-09-30T12:00:00Z") },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "pending" },
      data: { status: "expired" },
    });
    expect(moved.map((p) => p.id)).toEqual(["p1", "p2"]);
    // The merchant webhook for a plain expiry — which the bulk updateMany
    // never sent.
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("skips (and does not notify) a row that a poll moved in the meantime", async () => {
    findMany.mockResolvedValue([{ id: "raced" }, { id: "p2" }]);
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const moved = await expireStalePending();

    expect(moved.map((p) => p.id)).toEqual(["p2"]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("carries on through the batch when one notification throws", async () => {
    findMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
    notify.mockRejectedValueOnce(new Error("smtp down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const moved = await expireStalePending();

    expect(moved).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});

describe("timeoutStaleConfirming", () => {
  it("moves funded sessions to expired_received and unfunded ones to expired, notifying both", async () => {
    findMany.mockImplementation(async ({ where }) => {
      const funded = JSON.stringify(where).includes('"gt":0');
      return funded ? [{ id: "funded" }] : [{ id: "empty" }];
    });

    const { received, expired } = await timeoutStaleConfirming(
      new Date("2026-09-30T12:00:00Z"),
    );

    expect(received.map((p) => p.id)).toEqual(["funded"]);
    expect(expired.map((p) => p.id)).toEqual(["empty"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "funded", status: "confirming" },
      data: { status: "expired_received" },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "empty", status: "confirming" },
      data: { status: "expired" },
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("selects the unfunded bucket explicitly, never 'whatever is left'", async () => {
    findMany.mockResolvedValue([]);
    await timeoutStaleConfirming();

    const unfunded = JSON.stringify(findMany.mock.calls[1][0].where);
    expect(unfunded).toContain('"receivedAmount":null');
    expect(unfunded).toContain('"lte":0');
  });

  it("keys staleness off firstDetectedAt (createdAt for legacy rows), never updatedAt", async () => {
    findMany.mockResolvedValue([]);
    await timeoutStaleConfirming(new Date("2026-09-30T12:00:00Z"));

    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain("firstDetectedAt");
    expect(where).toContain("2026-09-29T12:00:00.000Z");
    expect(where).not.toContain("updatedAt");
  });
});
