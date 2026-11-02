import { describe, expect, it } from "vitest";
import { isChainTxHash, orphanKind, planOrphanCredit, refuseCredit } from "./orphan-review";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const orphan = { walletAddress: "0xabc", chain: "eth", token: "usdt" };
const session = (over: Record<string, unknown> = {}) => ({
  status: "expired",
  isTest: false,
  expiresAt: new Date(NOW - 60 * 60 * 1000),
  walletAddress: "0xabc",
  chain: "eth",
  token: "usdt",
  ...over,
});

describe("orphanKind", () => {
  it.each([
    ["0x5f1c9b", "transaction"],
    ["synthetic:eth:0xabc:20", "unattributed"],
    ["review:tie:eth:usdt:0xabc:120", "tie"],
  ])("%s is %s", (hash, kind) => {
    expect(orphanKind(hash)).toBe(kind);
  });

  it("never treats a synthetic or tie reference as a chain hash", () => {
    expect(isChainTxHash("synthetic:eth:0xabc:20")).toBe(false);
    expect(isChainTxHash("review:tie:eth:usdt:0xabc:1")).toBe(false);
    expect(isChainTxHash("0x5f1c9b")).toBe(true);
  });
});

/**
 * Attribution measures each session's balance delta on its own and doesn't
 * subtract what other sessions were credited, so a hand credit onto a session
 * the worker can still attribute to lets one deposit pay two sessions.
 */
describe("refuseCredit only allows sessions the worker can no longer credit", () => {
  it("allows an expired session past the grace period", () => {
    expect(refuseCredit(orphan, session(), NOW)).toBeNull();
    expect(refuseCredit(orphan, session({ status: "expired_received" }), NOW)).toBeNull();
  });

  it.each(["pending", "confirming", "underpaid"])("refuses a %s session (still watched)", (status) => {
    expect(refuseCredit(orphan, session({ status }), NOW)).toMatch(/Still being watched/);
  });

  it.each(["confirmed", "overpaid"])("refuses an already %s session", (status) => {
    expect(refuseCredit(orphan, session({ status }), NOW)).toMatch(/Already/);
  });

  it("refuses a session expired inside the 15-minute grace period", () => {
    expect(
      refuseCredit(orphan, session({ expiresAt: new Date(NOW - 5 * 60 * 1000) }), NOW),
    ).toMatch(/15 minutes/);
  });

  it("refuses another wallet, chain or token, and test sessions", () => {
    expect(refuseCredit(orphan, session({ walletAddress: "0xdef" }), NOW)).toMatch(/Different/);
    expect(refuseCredit(orphan, session({ token: "usdc" }), NOW)).toMatch(/Different/);
    expect(refuseCredit(orphan, session({ isTest: true }), NOW)).toMatch(/Test/);
  });
});

describe("planOrphanCredit", () => {
  it("adds to funds already on the session instead of replacing them", () => {
    expect(planOrphanCredit({ receivedAmount: 40, expectedAmount: 100 }, 60)).toEqual({
      receivedAmount: 100,
      status: "confirmed",
    });
  });

  it("settles a shortfall as expired_received, never underpaid (that reopens polling)", () => {
    expect(planOrphanCredit({ receivedAmount: null, expectedAmount: 100 }, 50).status).toBe(
      "expired_received",
    );
  });

  it("respects the merchant's threshold and flags overpayment", () => {
    expect(planOrphanCredit({ receivedAmount: null, expectedAmount: 100 }, 96, 0.95).status).toBe(
      "confirmed",
    );
    expect(planOrphanCredit({ receivedAmount: null, expectedAmount: 100 }, 96, 0.99).status).toBe(
      "expired_received",
    );
    expect(planOrphanCredit({ receivedAmount: null, expectedAmount: 100 }, 120).status).toBe("overpaid");
  });

  it("drops float noise from the sum", () => {
    expect(planOrphanCredit({ receivedAmount: 0.1, expectedAmount: 0.3 }, 0.2).receivedAmount).toBe(0.3);
  });
});
