import type { Payment } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paymentUpdate = vi.fn();
const paymentFindUnique = vi.fn().mockResolvedValue(null);
const sendEmail = vi.fn().mockResolvedValue({ success: true });
const checkPayment = vi.fn();

vi.mock("../lib/db", () => ({
  prisma: {
    payment: {
      update: (args: unknown) => paymentUpdate(args),
      updateMany: async (args: unknown) => {
        await paymentUpdate(args);
        return { count: 1 };
      },
      findUnique: (args: unknown) => paymentFindUnique(args),
    },
  },
}));
vi.mock("../lib/chains/registry", () => ({
  getAdapter: () => ({
    chain: "sol",
    supportedTokens: ["SOL", "USDC", "USDT"],
    getBalanceSnapshot: vi.fn(),
    checkPayment: (p: unknown) => checkPayment(p),
  }),
}));
vi.mock("../lib/payment/notify", () => ({ triggerNotifications: vi.fn() }));
vi.mock("../lib/payment/orphan", () => ({ logOrphanTransaction: vi.fn() }));
vi.mock("../lib/payment/match", () => ({
  loadWalletTags: async () => [],
  findBestMatchingSession: vi.fn(),
  GRACE_PERIOD_MS: 900_000,
  TOPUP_WINDOW_MS: 900_000,
}));
vi.mock("../lib/mailer", () => ({ sendEmail: (a: unknown) => sendEmail(a) }));

import { pollPayment } from "./poll";

/**
 * Regression cover for the 2026-09-01 outage (payment cmti1q2os, 10 USDT SOL):
 * the endpoint refused the SPL balance method, the adapter turned that into a
 * balance of zero, and every poll reported "no payment" silently.
 *
 * Invariant: a chain read that FAILS must never be indistinguishable from one
 * that found nothing.
 */
const session = {
  id: "cmti1q2os0010jj4vcnjtldig",
  chain: "sol",
  token: "usdt",
  walletAddress: "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D",
  expectedAmount: 10,
  balanceSnapshot: 0,
  receivedAmount: null,
  status: "pending",
  txHash: null,
  createdAt: new Date("2026-09-01T02:26:25Z"),
  firstDetectedAt: null,
  xrpDestinationTag: null,
  solMemoString: "073522dd",
  merchant: { underpaidThreshold: 0.99 },
} as unknown as Payment & { merchant: { underpaidThreshold: number } };

// Failure counts are module state keyed by payment id, so each case needs its
// own id.
const withId = (id: string) => ({ ...session, id }) as typeof session;

beforeEach(() => {
  vi.clearAllMocks();
  paymentUpdate.mockResolvedValue({ ...session });
  paymentFindUnique.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.env.ADMIN_EMAILS = "ops@example.com";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollPayment — unreadable chain vs. empty chain", () => {
  it("surfaces a refused balance read as an error instead of a quiet no-op", async () => {
    // What publicnode actually returned on every poll of this session.
    checkPayment.mockRejectedValue(
      new Error(
        "All endpoints failed for sol getTokenAccountsByOwner — https://solana.publicnode.com: 403 Forbidden: Indexed requests require a personal token",
      ),
    );

    const s = withId("repro-refused");
    await pollPayment(s);

    // Must be loud; the old path produced none of this.
    expect(console.error).toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain(s.id);

    // May reschedule with a backoff, but never write detection state — that is
    // what made a failed read look identical to a clean poll.
    const written = paymentUpdate.mock.calls.map((c) => c[0].data);
    for (const data of written) {
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("receivedAmount");
      expect(data).not.toHaveProperty("pollPhase");
    }
    // And the retry must be pushed into the future, not left past-due.
    expect(written[0].nextPollAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("escalates to an admin email once the failure is clearly persistent", async () => {
    checkPayment.mockRejectedValue(new Error("Indexed requests require a personal token"));

    const s = withId("repro-escalation");
    await pollPayment(s);
    await pollPayment(s);
    expect(sendEmail).not.toHaveBeenCalled(); // one blip is not an outage

    await pollPayment(s);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].subject).toContain(s.id);
    // Operators only: the alert carries a stack trace and wallet details.
    expect(sendEmail.mock.calls[0][0].to).toBe("ops@example.com");
  });

  it("still treats a genuinely empty wallet as a normal, silent no-detection", async () => {
    checkPayment.mockResolvedValue({ detected: false });

    await pollPayment(withId("repro-empty"));

    // Rescheduled, nothing raised — the behaviour the failure case above was
    // masquerading as.
    expect(paymentUpdate).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("credits the deposit once the read works — the payment that was lost", async () => {
    checkPayment.mockResolvedValue({
      detected: true,
      receivedAmount: 10,
      exclusive: true,
      txHash:
        "4xPenqdxdMcwRxzTfFoWH7KD2VbodgMQMzeYgBaqD8mYzseH22koEJRCxuXHtFG3wCTzADcGnHuFrTTidqHBbnkE",
      confirmations: 1,
      status: "confirmed",
    });

    await pollPayment(withId("repro-credited"));

    expect(paymentUpdate).toHaveBeenCalledTimes(1);
    const data = paymentUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("confirmed");
    expect(data.receivedAmount).toBe(10);
    expect(data.firstDetectedAt).toBeInstanceOf(Date);
  });
});
