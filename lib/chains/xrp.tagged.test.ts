import { beforeEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({
  balanceDrops: "0",
  transactions: [] as unknown[],
  accountError: null as null | { error: string; error_message: string },
}));

vi.mock("./rpc", () => ({
  defineEndpoints: (_env: string, defaults: readonly string[]) => defaults,
  resolveEndpoints: () => ["https://xrpl.test"],
  withEndpointFailover: (
    _key: string,
    _endpoints: string[],
    _label: string,
    fn: (a: { url: string; agent: null }) => unknown,
  ) => fn({ url: "https://xrpl.test", agent: null }),
}));

vi.mock("axios", () => ({
  default: {
    post: async (_url: string, body: { method: string }) =>
      body.method === "account_info"
        ? ledger.accountError
          ? { status: 200, data: { result: ledger.accountError } }
          : { status: 200, data: { result: { account_data: { Balance: ledger.balanceDrops } } } }
        : { status: 200, data: { result: { transactions: ledger.transactions } } },
  },
}));

import { classifySnapshotError } from "./errors";
import { xrpAdapter } from "./xrp";

const ADDR = "rMerchant";
const rippleTime = (d: Date) => Math.floor(d.getTime() / 1000) - 946_684_800;

function payment(hash: string, drops: number, tag?: number) {
  return {
    hash,
    tx: {
      hash,
      TransactionType: "Payment",
      Destination: ADDR,
      DestinationTag: tag,
      Amount: String(drops),
      date: rippleTime(new Date(Date.now() - 60_000)),
    },
    meta: { delivered_amount: String(drops) },
  };
}

beforeEach(() => {
  ledger.balanceDrops = "0";
  ledger.transactions = [];
  ledger.accountError = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("xrp untagged fallback (re-audit N3)", () => {
  const base = {
    address: ADDR,
    token: "XRP",
    expectedAmount: 10,
    balanceSnapshot: 0,
    createdAt: new Date(Date.now() - 10 * 60_000),
  };

  it("reports a deposit tagged for another session as reserved and never names it", async () => {
    ledger.balanceDrops = "10000000";
    ledger.transactions = [payment("HA", 10_000_000, 42)];
    const r = await xrpAdapter.checkPayment({ ...base, walletTags: ["42"] });
    expect(r.reserved).toEqual([expect.objectContaining({ amount: 10, tag: "42", txHash: "HA" })]);
    expect(r.txHash).toBeUndefined();
  });

  it("names an untagged payment as usual, with nothing reserved", async () => {
    ledger.balanceDrops = "10000000";
    ledger.transactions = [payment("HB", 10_000_000)];
    const r = await xrpAdapter.checkPayment({ ...base, walletTags: ["42"] });
    expect(r.reserved).toEqual([]);
    expect(r.txHash).toBe("HB");
  });
});

describe("xrp balance snapshot", () => {
  it("reads an unactivated account as a real zero", async () => {
    ledger.accountError = { error: "actNotFound", error_message: "Account not found." };
    await expect(xrpAdapter.getBalanceSnapshot(ADDR)).resolves.toBe(0);
  });

  // 2026-10-14: a Solana address saved as the XRP wallet read as 0, so
  // checkouts opened on it and every poll then failed until expiry.
  it("refuses a malformed address, classified as the merchant's to fix", async () => {
    ledger.accountError = { error: "actMalformed", error_message: "Account malformed." };
    const err = await xrpAdapter
      .getBalanceSnapshot("B8JGsTo5x4wUwP5xvsKiKTR41eN1ZTd7wNFbQDnoaDku")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(classifySnapshotError(err).status).toBe(400);
  });
});
