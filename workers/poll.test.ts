import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/chains/registry", () => ({ getAdapter: vi.fn() }));
vi.mock("../lib/db", () => ({
  prisma: {
    payment: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("../lib/payment/match", () => ({
  findBestMatchingSession: vi.fn(),
  loadWalletTags: vi.fn(async () => []),
  creditedToOthersSince: vi.fn(async () => 0),
}));
vi.mock("../lib/payment/notify", () => ({ triggerNotifications: vi.fn() }));
vi.mock("../lib/payment/orphan", () => ({ logOrphanTransaction: vi.fn() }));
vi.mock("../lib/admin-alerts", () => ({ sendAdminAlert: vi.fn(async () => true) }));

import { getAdapter } from "../lib/chains/registry";
import { prisma } from "../lib/db";
import { creditedToOthersSince, findBestMatchingSession } from "../lib/payment/match";
import { triggerNotifications } from "../lib/payment/notify";
import { logOrphanTransaction } from "../lib/payment/orphan";
import {
  getPollSchedule,
  pollPayment,
  settleUnseenConfirming,
} from "./poll";

describe("getPollSchedule (adaptive polling)", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("phase1 — polls every 15s while under 3 minutes old", () => {
    const r = getPollSchedule(0, now);
    expect(r.pollPhase).toBe("phase1");
    expect(r.pollInterval).toBe(15);
    expect(r.nextPollAt.getTime()).toBe(now.getTime() + 15_000);
  });

  it("phase2 — every 30s between 3 and 10 minutes", () => {
    const r = getPollSchedule(5, now);
    expect(r.pollPhase).toBe("phase2");
    expect(r.pollInterval).toBe(30);
  });

  it("phase3 — every 3 minutes between 10 and 60 minutes", () => {
    const r = getPollSchedule(30, now);
    expect(r.pollPhase).toBe("phase3");
    expect(r.pollInterval).toBe(180);
  });

  it("phase4 — every hour once over 60 minutes", () => {
    const r = getPollSchedule(120, now);
    expect(r.pollPhase).toBe("phase4");
    expect(r.pollInterval).toBe(3600);
    expect(r.nextPollAt.getTime()).toBe(now.getTime() + 3_600_000);
  });

  it("uses inclusive lower boundaries when advancing phases", () => {
    expect(getPollSchedule(3, now).pollPhase).toBe("phase2");
    expect(getPollSchedule(10, now).pollPhase).toBe("phase3");
    expect(getPollSchedule(60, now).pollPhase).toBe("phase4");
  });
});

// ── pollPayment attribution flow ───────────────────────────────────────────

const getAdapterMock = getAdapter as unknown as ReturnType<typeof vi.fn>;
const paymentUpdate = prisma.payment
  .update as unknown as ReturnType<typeof vi.fn>;
const paymentFindUnique = prisma.payment
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const findMatch = findBestMatchingSession as unknown as ReturnType<typeof vi.fn>;
const creditedElsewhere = creditedToOthersSince as unknown as ReturnType<typeof vi.fn>;
const notify = triggerNotifications as unknown as ReturnType<typeof vi.fn>;
const logOrphan = logOrphanTransaction as unknown as ReturnType<typeof vi.fn>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payment(o: Record<string, unknown> = {}): any {
  return {
    id: "pay1",
    chain: "eth",
    walletAddress: "0xwallet",
    token: "ETH",
    expectedAmount: 1,
    balanceSnapshot: 0,
    createdAt: new Date("2026-07-24T12:00:00.000Z"),
    xrpDestinationTag: null,
    solMemoString: null,
    txHash: null,
    status: "pending",
    ...o,
  };
}

function stubAdapter(result: Record<string, unknown>) {
  const checkPayment = vi.fn().mockResolvedValue(result);
  getAdapterMock.mockReturnValue({ checkPayment });
  return checkPayment;
}

function lastUpdateData() {
  return paymentUpdate.mock.calls.at(-1)?.[0].data;
}

beforeEach(() => {
  getAdapterMock.mockReset();
  paymentUpdate.mockReset().mockResolvedValue({});
  // Guarded outcome writes go through updateMany; record them alongside
  // update so assertions read every write in order.
  vi.mocked(prisma.payment.updateMany)
    .mockReset()
    .mockImplementation((async (args: unknown) => {
      await (paymentUpdate as unknown as (a: unknown) => Promise<unknown>)(args);
      return { count: 1 };
    }) as never);
  paymentFindUnique.mockReset().mockResolvedValue(null);
  findMatch.mockReset().mockResolvedValue(null);
  creditedElsewhere.mockReset().mockResolvedValue(0);
  notify.mockReset().mockResolvedValue(undefined);
  logOrphan.mockReset().mockResolvedValue(undefined);
});

describe("pollPayment", () => {
  it("skips entirely when chain/wallet/token is missing", async () => {
    await pollPayment(payment({ chain: null }));
    expect(getAdapterMock).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("advances only the poll schedule when nothing is detected", async () => {
    stubAdapter({ detected: false });
    await pollPayment(payment());
    expect(paymentUpdate).toHaveBeenCalledTimes(1);
    expect(lastUpdateData().status).toBeUndefined();
    expect(lastUpdateData()).toHaveProperty("nextPollAt");
    expect(notify).not.toHaveBeenCalled();
  });

  it("credits an exclusive (tag/memo) detection without consulting the matcher", async () => {
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 1,
      txHash: "0xtag",
      confirmations: 1,
      status: "confirmed",
    });
    await pollPayment(payment({ status: "pending" }));

    expect(findMatch).not.toHaveBeenCalled();
    expect(lastUpdateData().status).toBe("confirmed");
    expect(lastUpdateData().receivedAmount).toBe(1);
    expect(lastUpdateData().txHash).toBe("0xtag");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("attributes a balance detection using the absolute balance the adapter reports", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xdep",
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 1,
    });

    await pollPayment(payment({ id: "pay1", status: "pending" }));

    expect(findMatch).toHaveBeenCalledWith("0xwallet", "eth", "ETH", 1, 0.99, undefined, null, []);
    expect(lastUpdateData().status).toBe("confirmed");
    expect(lastUpdateData().receivedAmount).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("reconstructs the absolute balance from the snapshot when the adapter omits it", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 0.5,
      txHash: "0xdep",
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 0.5,
    });

    await pollPayment(payment({ id: "pay1", balanceSnapshot: 10 }));

    // 0.5 received + 10 snapshot = 10.5 absolute
    expect(findMatch).toHaveBeenCalledWith("0xwallet", "eth", "ETH", 10.5, 0.99, undefined, null, []);
  });

  it("threads the merchant's configured underpaid threshold into the adapter and matcher", async () => {
    const check = stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xdep",
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 1,
    });

    await pollPayment(
      payment({ id: "pay1", merchant: { underpaidThreshold: 0.9 } }),
    );

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ confirmedFrom: 0.9 }),
    );
    expect(findMatch).toHaveBeenCalledWith("0xwallet", "eth", "ETH", 1, 0.9, undefined, null, []);
  });

  it("passes the session's current status to the adapter", async () => {
    const check = stubAdapter({ detected: false });
    await pollPayment(payment({ status: "underpaid" }));
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ currentStatus: "underpaid" }),
    );
  });

  it("passes the session's snapshot basis to the adapter", async () => {
    const check = stubAdapter({ detected: false });
    await pollPayment(payment({ snapshotBasis: "balance" }));
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotBasis: "balance" }),
    );
  });

  it("falls back to the default threshold when the merchant has none joined", async () => {
    const check = stubAdapter({ detected: false });
    await pollPayment(payment());
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ confirmedFrom: 0.99 }),
    );
  });

  it("defers (schedule-only) when a different session is the best match", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xdep",
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue({
      session: { id: "OTHER" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 1,
    });

    await pollPayment(payment({ id: "pay1", status: "pending" }));

    expect(lastUpdateData().status).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
    expect(logOrphan).not.toHaveBeenCalled();
  });

  it("logs an orphan with the real tx hash when nothing matches", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 2,
      currentBalance: 2,
      txHash: "0xorphan",
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue(null);

    await pollPayment(payment());

    expect(logOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xorphan", receivedAmount: 2 }),
    );
    expect(lastUpdateData().status).toBeUndefined();
  });

  it("logs an orphan with a deterministic synthetic key when the tx hash is unresolved", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 2,
      currentBalance: 2,
      confirmations: 0,
    });
    findMatch.mockResolvedValue(null);

    await pollPayment(payment({ chain: "eth", walletAddress: "0xwallet" }));

    expect(logOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "synthetic:eth:0xwallet:2" }),
    );
  });

  // 2026-10-14: the hourly expired watch re-read a session expired hours
  // earlier; its diff held 0.002067 ETH already credited to the session it
  // paid, the native scan could no longer resolve the hash, and admins got an
  // "Unmatched Transaction" alert for money that was accounted for.
  it("raises no orphan for a hashless diff already credited to other sessions", async () => {
    stubAdapter({ detected: true, receivedAmount: 0.002067, currentBalance: 0.021889 });
    findMatch.mockResolvedValue(null);
    creditedElsewhere.mockResolvedValue(0.002067);

    await pollPayment(payment({ status: "expired", balanceSnapshot: 0.019822 }));

    expect(logOrphan).not.toHaveBeenCalled();
    expect(lastUpdateData().status).toBeUndefined();
  });

  it("raises only the part of a hashless diff nobody was credited", async () => {
    stubAdapter({ detected: true, receivedAmount: 5, currentBalance: 105 });
    findMatch.mockResolvedValue(null);
    creditedElsewhere.mockResolvedValue(3);

    await pollPayment(payment({ chain: "eth", walletAddress: "0xwallet", balanceSnapshot: 100 }));

    expect(logOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "synthetic:eth:0xwallet:2", receivedAmount: 2 }),
    );
  });

  it("never nets a real tx hash: an unclaimed hash is new money", async () => {
    stubAdapter({ detected: true, receivedAmount: 2, currentBalance: 2, txHash: "0xnew" });
    findMatch.mockResolvedValue(null);
    creditedElsewhere.mockResolvedValue(10);

    await pollPayment(payment());

    expect(logOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xnew", receivedAmount: 2 }),
    );
  });

  it("skips a tx already credited to a different session (dedup)", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xused",
      confirmations: 12,
      status: "confirmed",
    });
    paymentFindUnique.mockResolvedValue({ id: "OTHER" });

    await pollPayment(payment({ id: "pay1" }));

    expect(findMatch).not.toHaveBeenCalled();
    expect(lastUpdateData().status).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it("proceeds when the deduped tx belongs to this same session", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xself",
      confirmations: 12,
      status: "confirmed",
    });
    paymentFindUnique.mockResolvedValue({ id: "pay1" });
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 1,
    });

    await pollPayment(payment({ id: "pay1" }));

    expect(findMatch).toHaveBeenCalled();
    expect(lastUpdateData().status).toBe("confirmed");
  });

  it("marks a late deposit on an expired session as expired_received", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xlate",
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 1,
    });

    await pollPayment(payment({ id: "pay1", status: "expired" }));

    expect(lastUpdateData().status).toBe("expired_received");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stays in confirming until the adapter reports enough confirmations", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 1,
      currentBalance: 1,
      txHash: "0xdep",
      confirmations: 2,
      status: "confirming",
    });
    // Even though the matcher classifies it confirmed on amount, an
    // under-confirmed adapter result must keep the session in "confirming".
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 1,
    });

    await pollPayment(payment({ id: "pay1", status: "pending" }));

    expect(lastUpdateData().status).toBe("confirming");
    expect(notify).toHaveBeenCalledTimes(1); // pending → confirming is a change
  });

  it("does not fire notifications when the status is unchanged", async () => {
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 0.5,
      txHash: "0xtag",
      confirmations: 0,
      status: "confirming",
    });

    await pollPayment(payment({ id: "pay1", status: "confirming" }));

    expect(lastUpdateData().status).toBe("confirming");
    expect(notify).not.toHaveBeenCalled();
  });
});

// ── firstDetectedAt anchor ─────────────────────────────────────────────────
// This timestamp is what lets a session escape "confirming": it anchors the
// age-derived confirmation count and the 24h timeout. Both are unusable off
// updatedAt, which every poll refreshes, so it must be stamped once and then
// never move.

describe("pollPayment — firstDetectedAt", () => {
  it("stamps the detection time on the first poll that sees funds", async () => {
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 1,
      txHash: "0xabc",
      confirmations: 0,
      status: "confirming",
    });
    await pollPayment(payment({ firstDetectedAt: null }));

    expect(lastUpdateData().firstDetectedAt).toBeInstanceOf(Date);
  });

  it("keeps the original stamp on later polls so the anchor can't drift", async () => {
    const original = new Date("2026-07-24T12:05:00.000Z");
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 1,
      txHash: "0xabc",
      confirmations: 3,
      status: "confirming",
    });
    await pollPayment(
      payment({ firstDetectedAt: original, status: "confirming" }),
    );

    expect(lastUpdateData().firstDetectedAt).toBe(original);
  });

  it("does not stamp a session that has seen no funds", async () => {
    stubAdapter({ detected: false });
    await pollPayment(payment({ firstDetectedAt: null }));

    expect(lastUpdateData().firstDetectedAt).toBeUndefined();
  });
});

// ── re-confirmation params ─────────────────────────────────────────────────

describe("pollPayment — adapter params", () => {
  it("passes the credited amount and detection anchor so an attributed tx can be re-confirmed after a wallet sweep", async () => {
    const check = stubAdapter({ detected: false });
    const firstDetectedAt = new Date("2026-07-24T12:05:00.000Z");
    await pollPayment(
      payment({ txHash: "0xabc", receivedAmount: 2.5, firstDetectedAt }),
    );

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        existingTxHash: "0xabc",
        creditedAmount: 2.5,
        firstDetectedAt,
      }),
    );
  });
});

// ── settling a confirming session after the merchant sweeps the wallet ─────
// Balance-diff detection goes blind the moment the merchant moves the funds.
// These cover the rule that keeps such a session from sitting in "confirming".

describe("settleUnseenConfirming", () => {
  const detected = new Date("2026-07-24T12:00:00.000Z");
  const wellPastConfirmation = new Date("2026-07-24T13:00:00.000Z");

  function confirming(o: Record<string, unknown> = {}) {
    return payment({
      status: "confirming",
      token: "eth",
      expectedAmount: 1,
      receivedAmount: 1,
      firstDetectedAt: detected,
      ...o,
    });
  }

  it("settles a fully-paid session once it has aged past the requirement", () => {
    expect(settleUnseenConfirming(confirming(), wellPastConfirmation)).toBe(
      "confirmed",
    );
  });

  it("classifies the credited amount rather than assuming success", () => {
    expect(
      settleUnseenConfirming(
        confirming({ receivedAmount: 0.4 }),
        wellPastConfirmation,
      ),
    ).toBe("underpaid");
    expect(
      settleUnseenConfirming(
        confirming({ receivedAmount: 2 }),
        wellPastConfirmation,
      ),
    ).toBe("overpaid");
  });

  it("waits until the chain's confirmation requirement is met", () => {
    // 12 ETH confirmations ≈ 2.4 minutes; one minute in is too early.
    const tooEarly = new Date(detected.getTime() + 60_000);
    expect(settleUnseenConfirming(confirming(), tooEarly)).toBeNull();
  });

  it("never invents a payment for a session that was never credited", () => {
    expect(
      settleUnseenConfirming(
        confirming({ receivedAmount: null }),
        wellPastConfirmation,
      ),
    ).toBeNull();
    expect(
      settleUnseenConfirming(
        confirming({ receivedAmount: 0 }),
        wellPastConfirmation,
      ),
    ).toBeNull();
  });

  it("only applies to sessions actually in confirming", () => {
    for (const status of ["pending", "expired", "confirmed", "underpaid"]) {
      expect(
        settleUnseenConfirming(confirming({ status }), wellPastConfirmation),
      ).toBeNull();
    }
  });

  it("falls back to createdAt for rows predating firstDetectedAt", () => {
    expect(
      settleUnseenConfirming(
        confirming({ firstDetectedAt: null }),
        wellPastConfirmation,
      ),
    ).toBe("confirmed");
  });
});

describe("pollPayment — exact ties (re-audit 3, finding 1)", () => {
  it("credits nobody on a tie and raises a review once per balance", async () => {
    stubAdapter({
      detected: true,
      receivedAmount: 100,
      currentBalance: 100,
      confirmations: 12,
      status: "confirmed",
    });
    findMatch.mockResolvedValue({
      session: { id: "pay1" },
      delta: 0,
      status: "confirmed",
      receivedAmount: 100,
      tie: true,
    });

    await pollPayment(payment({ id: "pay1" }));

    expect(logOrphan).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "review:tie:eth:ETH:0xwallet:100" }),
    );
    expect(notify).not.toHaveBeenCalled();
    const writes = vi.mocked(prisma.payment.update).mock.calls.map((c) => c[0].data);
    expect(writes.every((d) => !("status" in d) && !("receivedAmount" in d))).toBe(true);
  });
});

describe("pollPayment — guarded outcome writes", () => {
  it("guards the outcome write on the status and credited amount it read", async () => {
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 1,
      txHash: "0xtag",
      confirmations: 1,
      status: "confirmed",
    });
    await pollPayment(payment({ id: "pay1", status: "pending", receivedAmount: null }));
    const call = vi.mocked(prisma.payment.updateMany).mock.calls.at(-1)![0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "pay1", status: "pending", receivedAmount: null });
  });

  it("discards its outcome, without notifying, when the row moved during the poll", async () => {
    vi.mocked(prisma.payment.updateMany).mockResolvedValue({ count: 0 } as never);
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 1,
      txHash: "0xtag",
      confirmations: 1,
      status: "confirmed",
    });
    await pollPayment(payment({ id: "pay1" }));
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps a recorded tx hash when this poll could not resolve one", async () => {
    stubAdapter({
      detected: true,
      exclusive: true,
      receivedAmount: 1,
      confirmations: 1,
      status: "confirmed",
    });
    await pollPayment(payment({ id: "pay1", txHash: "0xrecorded" }));
    expect(lastUpdateData().txHash).toBe("0xrecorded");
  });
});
