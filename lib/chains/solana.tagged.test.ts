import { beforeEach, describe, expect, it, vi } from "vitest";

const node = vi.hoisted(() => ({
  lamports: 0,
  sigs: [] as unknown[],
  txs: {} as Record<string, unknown>,
}));

vi.mock("./rpc", () => ({
  defineEndpoints: (_env: string, defaults: readonly string[]) => defaults,
  isEndpointRefusal: () => false,
  resolveEndpoints: () => ["https://sol.test"],
  withEndpointFailover: (
    _key: string,
    _endpoints: string[],
    _label: string,
    fn: (a: { url: string; agent: null }) => unknown,
  ) => fn({ url: "https://sol.test", agent: null }),
}));

vi.mock("@solana/web3.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@solana/web3.js")>();
  class FakeConnection {
    async getBalance() {
      return node.lamports;
    }
    async getSignaturesForAddress() {
      return node.sigs;
    }
    async getParsedTransaction(sig: string) {
      return node.txs[sig] ?? null;
    }
  }
  return { ...orig, Connection: FakeConnection };
});

import { PublicKey } from "@solana/web3.js";
import { solanaAdapter } from "./solana";

const OWNER = new PublicKey("ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D");
const OTHER = new PublicKey("11111111111111111111111111111111");
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const secsAgo = (s: number) => Math.floor(Date.now() / 1000) - s;

function nativeTx(sol: number, memo?: string) {
  const pre = 1_000 * 1e9;
  return {
    meta: { err: null, preBalances: [pre, 0], postBalances: [pre + sol * 1e9, 0] },
    transaction: {
      message: {
        accountKeys: [{ pubkey: OWNER }, { pubkey: OTHER }],
        instructions: memo ? [{ programId: MEMO, parsed: memo }] : [],
      },
    },
  };
}
const sig = (signature: string, age: number, memo: string | null = null) => ({
  signature,
  err: null,
  blockTime: secsAgo(age),
  memo,
  confirmationStatus: "finalized",
});

beforeEach(() => {
  node.lamports = 0;
  node.sigs = [];
  node.txs = {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sol untagged fallback (re-audit N3)", () => {
  const base = {
    address: OWNER.toString(),
    token: "SOL",
    expectedAmount: 10,
    balanceSnapshot: 0,
    createdAt: new Date(Date.now() - 10 * 60_000),
  };

  it("reports a deposit carrying another session's memo as reserved and never names it", async () => {
    node.lamports = 10 * 1e9;
    node.sigs = [sig("tagged", 30, "[8] aaaa1111")];
    node.txs = { tagged: nativeTx(10, "aaaa1111") };
    const r = await solanaAdapter.checkPayment({ ...base, walletTags: ["aaaa1111"] });
    expect(r.reserved).toEqual([
      expect.objectContaining({ amount: 10, tag: "aaaa1111", txHash: "tagged" }),
    ]);
    expect(r.txHash).toBeUndefined();
  });

  it("does not reserve on a memo that only contains the tag as a substring", async () => {
    node.lamports = 10 * 1e9;
    node.sigs = [sig("near", 30, "[12] xxaaaa1111xx")];
    node.txs = { near: nativeTx(10, "xxaaaa1111xx") };
    const r = await solanaAdapter.checkPayment({ ...base, walletTags: ["aaaa1111"] });
    expect(r.reserved).toEqual([]);
    expect(r.txHash).toBe("near");
  });
});
