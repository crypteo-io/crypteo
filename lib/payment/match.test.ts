import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: { payment: { findMany: vi.fn() } },
}));

import { prisma } from "../db";
import {
  creditedToOthersSince,
  findBestMatchingSession,
  GRACE_PERIOD_MS,
  reservedForOthers,
  TOPUP_WINDOW_MS,
} from "./match";

const findMany = prisma.payment.findMany as unknown as ReturnType<typeof vi.fn>;

type SessionOverrides = Partial<{
  id: string;
  status: string;
  expectedAmount: number;
  balanceSnapshot: number;
  createdAt: Date;
}>;

function session(o: SessionOverrides = {}) {
  return {
    id: o.id ?? "p1",
    walletAddress: "0xwallet",
    chain: "eth",
    token: "ETH",
    status: o.status ?? "pending",
    expectedAmount: o.expectedAmount ?? 1,
    balanceSnapshot: o.balanceSnapshot ?? 0,
    createdAt: o.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    txHash: null,
    isTest: false,
  };
}

/** Route the three findMany calls (pending/confirming, expired, underpaid). */
function stubBuckets(buckets: {
  pending?: ReturnType<typeof session>[];
  expired?: ReturnType<typeof session>[];
  underpaid?: ReturnType<typeof session>[];
}) {
  findMany.mockImplementation(
    async ({ where }: { where: { status?: unknown } }) => {
      const status = where.status as { in?: string[] } | string;
      if (typeof status === "object" && status.in) return buckets.pending ?? [];
      if (status === "expired") return buckets.expired ?? [];
      if (status === "underpaid") return buckets.underpaid ?? [];
      return [];
    },
  );
}

beforeEach(() => {
  findMany.mockReset();
});

describe("findBestMatchingSession", () => {
  it("derives each candidate's received from its OWN snapshot against the absolute balance", async () => {
    // currentBalance 1.5. A (snap 0) would read 1.5 (over); B (snap 0.5) reads
    // exactly 1.0 → B is the true match even though its snapshot is larger.
    stubBuckets({
      pending: [
        session({ id: "A", balanceSnapshot: 0, expectedAmount: 1 }),
        session({ id: "B", balanceSnapshot: 0.5, expectedAmount: 1 }),
      ],
    });

    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1.5);

    expect(match?.session.id).toBe("B");
    expect(match?.receivedAmount).toBe(1);
    expect(match?.delta).toBe(0);
    expect(match?.status).toBe("confirmed");
  });

  it("filters out candidates whose snapshot exceeds the current balance", async () => {
    // C's snapshot (2) is above the current balance (1) → negative received.
    stubBuckets({
      pending: [
        session({ id: "C", balanceSnapshot: 2, expectedAmount: 1 }),
        session({ id: "A", balanceSnapshot: 0, expectedAmount: 1 }),
      ],
    });

    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1);

    expect(match?.session.id).toBe("A");
    expect(match?.receivedAmount).toBe(1);
  });

  it("returns null when there are no candidate sessions", async () => {
    stubBuckets({});
    expect(await findBestMatchingSession("0xwallet", "eth", "ETH", 1)).toBeNull();
  });

  it("returns null when every candidate has non-positive received", async () => {
    stubBuckets({
      pending: [session({ id: "A", balanceSnapshot: 5, expectedAmount: 1 })],
    });
    // currentBalance below every snapshot → nobody plausibly received it.
    expect(
      await findBestMatchingSession("0xwallet", "eth", "ETH", 1),
    ).toBeNull();
  });

  it("breaks ties on equal deltas by preferring the newest session", async () => {
    const older = session({
      id: "OLD",
      balanceSnapshot: 0,
      expectedAmount: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = session({
      id: "NEW",
      balanceSnapshot: 0,
      expectedAmount: 1,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    stubBuckets({ pending: [older, newer] });

    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    expect(match?.session.id).toBe("NEW");
  });

  it("classifies the winner with the shared tolerance — underpaid", async () => {
    stubBuckets({
      pending: [session({ id: "A", balanceSnapshot: 0, expectedAmount: 1 })],
    });
    // 0.9 / 1 = 0.90 < 0.99 floor.
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 0.9);
    expect(match?.status).toBe("underpaid");
  });

  it("classifies the winner with the shared tolerance — overpaid", async () => {
    stubBuckets({
      pending: [session({ id: "A", balanceSnapshot: 0, expectedAmount: 1 })],
    });
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1.5);
    expect(match?.status).toBe("overpaid");
  });

  it("considers recently-expired (grace) sessions as candidates", async () => {
    stubBuckets({
      expired: [session({ id: "EXP", status: "expired", expectedAmount: 1 })],
    });
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    expect(match?.session.id).toBe("EXP");
  });

  it("considers underpaid sessions inside the top-up window as candidates", async () => {
    stubBuckets({
      underpaid: [
        session({ id: "UP", status: "underpaid", expectedAmount: 1 }),
      ],
    });
    // A later top-up pushes the absolute balance to a full match → completes.
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    expect(match?.session.id).toBe("UP");
    expect(match?.status).toBe("confirmed");
  });

  it("queries grace-expired sessions bounded by GRACE_PERIOD_MS and unattributed", async () => {
    stubBuckets({});
    const before = Date.now();
    await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    const after = Date.now();

    const expiredCall = findMany.mock.calls.find(
      ([arg]) => arg.where.status === "expired",
    );
    expect(expiredCall).toBeDefined();
    const where = expiredCall![0].where;
    expect(where.txHash).toBeNull();
    expect(where.isTest).toBe(false);
    const graceLowerBound = where.expiresAt.gt.getTime();
    expect(graceLowerBound).toBeGreaterThanOrEqual(before - GRACE_PERIOD_MS);
    expect(graceLowerBound).toBeLessThanOrEqual(after - GRACE_PERIOD_MS);
  });

  it("queries underpaid sessions bounded by TOPUP_WINDOW_MS on expiresAt", async () => {
    stubBuckets({});
    const before = Date.now();
    await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    const after = Date.now();

    const underpaidCall = findMany.mock.calls.find(
      ([arg]) => arg.where.status === "underpaid",
    );
    expect(underpaidCall).toBeDefined();
    const where = underpaidCall![0].where;
    expect(where.isTest).toBe(false);
    const windowLowerBound = where.expiresAt.gt.getTime();
    expect(windowLowerBound).toBeGreaterThanOrEqual(before - TOPUP_WINDOW_MS);
    expect(windowLowerBound).toBeLessThanOrEqual(after - TOPUP_WINDOW_MS);
  });

  it("scopes the pending query to the wallet/chain/token and non-test open sessions", async () => {
    stubBuckets({});
    await findBestMatchingSession("0xwallet", "eth", "ETH", 1);

    const pendingCall = findMany.mock.calls.find(
      ([arg]) =>
        typeof arg.where.status === "object" && arg.where.status.in,
    );
    expect(pendingCall).toBeDefined();
    const where = pendingCall![0].where;
    expect(where.walletAddress).toBe("0xwallet");
    expect(where.chain).toBe("eth");
    expect(where.token).toBe("ETH");
    expect(where.isTest).toBe(false);
    expect(where.status.in).toEqual(["pending", "confirming"]);
  });

  it("classifies the winner using the merchant's configured threshold", async () => {
    stubBuckets({
      pending: [session({ id: "A", balanceSnapshot: 0, expectedAmount: 1 })],
    });
    // 0.92 of expected: underpaid at the 0.99 default, confirmed at 0.9.
    const strict = await findBestMatchingSession("0xwallet", "eth", "ETH", 0.92);
    expect(strict?.status).toBe("underpaid");

    const lenient = await findBestMatchingSession(
      "0xwallet",
      "eth",
      "ETH",
      0.92,
      0.9,
    );
    expect(lenient?.status).toBe("confirmed");
  });

  it("picks the globally-best candidate across all three buckets", async () => {
    // Absolute balance 1.0. Pending session is a poor match (expects 5);
    // an underpaid session expecting exactly 1 is the true best.
    stubBuckets({
      pending: [session({ id: "P", balanceSnapshot: 0, expectedAmount: 5 })],
      underpaid: [
        session({ id: "UP", status: "underpaid", balanceSnapshot: 0, expectedAmount: 1 }),
      ],
    });
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    expect(match?.session.id).toBe("UP");
  });
});

describe("snapshot basis", () => {
  it("only compares sessions whose snapshot shares the poller's basis", async () => {
    stubBuckets({ pending: [session()] });
    await findBestMatchingSession("0xwallet", "btc", "btc", 1, 0.99, undefined, "balance");
    for (const [args] of findMany.mock.calls) {
      expect(args.where.snapshotBasis).toBe("balance");
    }
  });

  it("defaults to the legacy (null) basis", async () => {
    stubBuckets({ pending: [session()] });
    await findBestMatchingSession("0xwallet", "eth", "ETH", 1);
    expect(findMany.mock.calls.length).toBe(3);
    for (const [args] of findMany.mock.calls) {
      expect(args.where.snapshotBasis).toBeNull();
    }
  });
});

describe("exact ties (re-audit 3, finding 1)", () => {
  it("flags two same-price sessions matching one deposit as a tie instead of picking the newest", async () => {
    stubBuckets({
      pending: [
        session({ id: "A", expectedAmount: 100, createdAt: new Date("2026-01-01T00:00:00Z") }),
        session({ id: "B", expectedAmount: 100, createdAt: new Date("2026-01-01T00:01:00Z") }),
      ],
    });
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 100);
    expect(match?.tie).toBe(true);
  });

  it("does not flag a tie when the amounts tell the sessions apart", async () => {
    stubBuckets({
      pending: [
        session({ id: "A", expectedAmount: 100.000037 }),
        session({ id: "B", expectedAmount: 100.000012 }),
      ],
    });
    const match = await findBestMatchingSession("0xwallet", "eth", "ETH", 100.000037);
    expect(match).toMatchObject({ tie: false });
    expect(match?.session.id).toBe("A");
  });
});

describe("tagged deposits are never another session's (re-audit N3)", () => {
  const tagged = (o: Record<string, unknown>) => ({
    ...session({ id: o.id as string, expectedAmount: 10 }),
    snapshotAt: new Date("2026-01-01T00:00:00Z"),
    xrpDestinationTag: (o.tag as string) ?? null,
    solMemoString: null,
  });

  it("keeps a deposit tagged for A out of untagged B's figure, so A wins outright", async () => {
    stubBuckets({
      pending: [
        tagged({ id: "A", tag: "42" }) as never,
        tagged({ id: "B" }) as never,
      ],
    });
    const reserved = [{ amount: 10, at: new Date("2026-01-01T00:05:00Z"), tag: "42", txHash: "HA" }];
    const match = await findBestMatchingSession("0xwallet", "xrp", "xrp", 10, 0.99, undefined, null, reserved);
    expect(match?.session.id).toBe("A");
    expect(match?.tie).toBe(false);
  });

  it("does not subtract a tagged deposit that predates the session's snapshot", () => {
    const B = tagged({ id: "B" });
    const reserved = [{ amount: 10, at: new Date("2025-12-31T23:59:00Z"), tag: "42" }];
    expect(reservedForOthers(B as never, reserved)).toBe(0);
  });

  it("never subtracts a session's own tagged deposit", () => {
    const A = tagged({ id: "A", tag: "42" });
    const reserved = [{ amount: 10, at: new Date("2026-01-01T00:05:00Z"), tag: "42" }];
    expect(reservedForOthers(A as never, reserved)).toBe(0);
  });
});

describe("creditedToOthersSince", () => {
  const anchor = new Date("2026-10-14T05:47:45.000Z");
  const base = {
    id: "expired1",
    walletAddress: "0xwallet",
    chain: "eth",
    token: "eth",
    snapshotAt: anchor,
    createdAt: new Date("2026-10-14T05:47:35.000Z"),
    snapshotBasis: null,
  };

  beforeEach(() => findMany.mockReset());

  it("sums other sessions' on-chain credits detected after this session's snapshot", async () => {
    findMany.mockResolvedValue([{ receivedAmount: 0.002067 }, { receivedAmount: 0.001 }]);
    expect(await creditedToOthersSince(base)).toBeCloseTo(0.003067, 9);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: { not: "expired1" },
      walletAddress: "0xwallet",
      chain: "eth",
      token: "eth",
      isTest: false,
      snapshotBasis: null,
      receivedAmount: { gt: 0 },
      // Hand-marked payments have no detection stamp and so never count.
      firstDetectedAt: { gt: anchor },
    });
  });

  it("anchors on createdAt for rows without a snapshot time", async () => {
    findMany.mockResolvedValue([]);
    await creditedToOthersSince({ ...base, snapshotAt: null });
    expect(findMany.mock.calls[0][0].where.firstDetectedAt).toEqual({ gt: base.createdAt });
  });
});
