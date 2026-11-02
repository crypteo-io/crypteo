import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    wallet: { findUnique: vi.fn() },
    payment: { updateMany: vi.fn() },
    chainReadFailure: { create: vi.fn(async () => ({})) },
  },
}));

const getBalanceSnapshot = vi.fn();
vi.mock("@/lib/chains/registry", () => ({
  getAdapter: (chain: string) =>
    ["eth", "sol", "xrp", "btc"].includes(chain)
      ? { getBalanceSnapshot }
      : undefined,
  isSupportedPair: (chain: string, token: string) =>
    !(chain === "btc" && token !== "btc"),
}));

vi.mock("@/lib/pricing", () => ({ getTokenPriceInUsd: vi.fn() }));

import { prisma } from "@/lib/db";
import { getTokenPriceInUsd } from "@/lib/pricing";
import {
  AssignableSession,
  canReassign,
  commitAssignment,
  positiveAmountSchema,
  BILLING_HOLD_MESSAGE,
  resolveAssignment,
  usdBase,
} from "./assign";

const findWallet = prisma.wallet.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const updateMany = prisma.payment.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const price = getTokenPriceInUsd as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-09-30T12:00:00.000Z");

function session(o: Partial<AssignableSession> = {}): AssignableSession {
  return {
    status: "pending",
    chain: null,
    token: null,
    receivedAmount: null,
    firstDetectedAt: null,
    txHash: null,
    expiresAt: new Date(NOW.getTime() + 30 * 60 * 1000),
    expectedAmount: 100,
    metadata: null,
    paymentLink: null,
    ...o,
  };
}

// A valid receiving address per chain: assignment refuses any other.
const VALID_ADDRESS: Record<string, string> = {
  eth: "0x6d7f880dDDBCb37d721e0d5D7a0d2bE2Bc9aDC96",
  sol: "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D",
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
};

function walletFor({ where }: { where: { merchantId_chain_token: { chain: string } } }) {
  return {
    address: VALID_ADDRESS[where.merchantId_chain_token.chain],
    isActive: true,
    merchant: { isActive: true },
  };
}

beforeEach(() => {
  findWallet.mockReset();
  updateMany.mockReset();
  price.mockReset();
  getBalanceSnapshot.mockReset();
  findWallet.mockImplementation(async (args: never) => walletFor(args));
});

describe("positiveAmountSchema", () => {
  it.each([0, -1, "0", "-5", "abc", "", NaN, Infinity, "Infinity"])(
    "rejects %s",
    (v) => {
      expect(positiveAmountSchema.safeParse(v).success).toBe(false);
    },
  );

  it("accepts positive numbers and numeric strings", () => {
    expect(positiveAmountSchema.parse(0.5)).toBe(0.5);
    expect(positiveAmountSchema.parse("12.25")).toBe(12.25);
  });
});

describe("usdBase", () => {
  it("uses the recorded USD base when present", () => {
    expect(
      usdBase(session({ chain: "eth", metadata: { originalUsdAmount: 250 } })),
    ).toBe(250);
  });

  it("treats an unassigned session's amount as USD", () => {
    expect(usdBase(session({ expectedAmount: 42 }))).toBe(42);
  });

  it("refuses to read a merchant-priced token amount as USD", () => {
    // The repricing bug: 0.5 ETH read as $0.50 → ~0.00017 ETH.
    expect(usdBase(session({ chain: "eth", expectedAmount: 0.5 }))).toBeNull();
  });
});

describe("canReassign", () => {
  it("allows first selection on an unassigned pending session", () => {
    expect(canReassign(session(), "eth", "usdc", NOW)).toEqual({
      ok: true,
      noop: false,
    });
  });

  it.each([
    ["status is not pending", { status: "confirming" }],
    ["funds were received", { receivedAmount: 0.1 }],
    ["a deposit was detected", { firstDetectedAt: NOW }],
    ["a tx was attributed", { txHash: "0xabc" }],
    ["the session expired", { expiresAt: new Date(NOW.getTime() - 1) }],
  ])("409s when %s", (_label, o) => {
    const d = canReassign(
      session(o as Partial<AssignableSession>),
      "eth",
      "eth",
      NOW,
    );
    expect(d).toMatchObject({ ok: false, status: 409 });
  });

  it("is a no-op when the pair is unchanged", () => {
    const s = session({ chain: "eth", token: "usdc" });
    expect(canReassign(s, "ETH", "USDC", NOW)).toEqual({
      ok: true,
      noop: true,
    });
  });

  it("refuses to switch a merchant-fixed (token-priced) session", () => {
    const s = session({ chain: "eth", token: "eth", expectedAmount: 0.5 });
    expect(canReassign(s, "eth", "usdc", NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("refuses to switch a chain pinned by the payment link", () => {
    const s = session({
      chain: "eth",
      token: "usdc",
      metadata: { originalUsdAmount: 100 },
      paymentLink: { chain: "eth", token: "usdc" },
    });
    expect(canReassign(s, "sol", "usdc", NOW)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("allows the buyer to change a USD-denominated selection", () => {
    const s = session({
      chain: "eth",
      token: "eth",
      metadata: { originalUsdAmount: 100 },
    });
    expect(canReassign(s, "sol", "sol", NOW)).toEqual({
      ok: true,
      noop: false,
    });
  });
});

describe("resolveAssignment", () => {
  const base = { merchantId: "m1", context: "test" };

  it("rejects an unsupported pair before touching the wallet", async () => {
    const r = await resolveAssignment({
      ...base,
      chain: "btc",
      token: "usdc",
      amount: { crypto: 1 },
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(findWallet).not.toHaveBeenCalled();
  });

  it("rejects an inactive wallet", async () => {
    findWallet.mockResolvedValue({ address: VALID_ADDRESS.eth, isActive: false, merchant: { isActive: true } });
    const r = await resolveAssignment({
      ...base,
      chain: "eth",
      token: "usdc",
      amount: { crypto: 1 },
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("fails closed on an unreadable balance instead of snapshotting 0", async () => {
    getBalanceSnapshot.mockRejectedValue(new Error("socket hang up"));
    const r = await resolveAssignment({
      ...base,
      chain: "eth",
      token: "usdc",
      amount: { crypto: 1 },
    });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("snapshots the wallet and converts a USD amount", async () => {
    getBalanceSnapshot.mockResolvedValue(7_700_000);
    price.mockResolvedValue(3000);
    const r = await resolveAssignment({
      ...base,
      chain: "ETH",
      token: "ETH",
      amount: { usd: 1500 },
    });
    expect(r).toMatchObject({
      ok: true,
      fields: {
        chain: "eth",
        token: "eth",
        walletAddress: VALID_ADDRESS.eth,
        balanceSnapshot: 7_700_000,
        expectedAmount: 0.5,
      },
    });
  });

  it("keeps a token amount as-is and skips pricing", async () => {
    getBalanceSnapshot.mockResolvedValue(0);
    const r = await resolveAssignment({
      ...base,
      chain: "eth",
      token: "eth",
      amount: { crypto: 0.5 },
    });
    expect(r).toMatchObject({ ok: true, fields: { expectedAmount: 0.5 } });
    expect(price).not.toHaveBeenCalled();
  });

  it("503s when the price feed is down", async () => {
    getBalanceSnapshot.mockResolvedValue(0);
    price.mockRejectedValue(new Error("down"));
    const r = await resolveAssignment({
      ...base,
      chain: "eth",
      token: "eth",
      amount: { usd: 10 },
    });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("issues a per-session XRP tag, not the wallet's static one", async () => {
    findWallet.mockResolvedValue({
      address: VALID_ADDRESS.xrp,
      isActive: true,
      xrpTag: "123",
      merchant: { isActive: true },
    });
    getBalanceSnapshot.mockResolvedValue(10);
    const r = await resolveAssignment({
      ...base,
      chain: "xrp",
      token: "xrp",
      amount: { crypto: 5 },
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.fields.xrpDestinationTag).toMatch(/^\d+$/);
    expect(r.fields.xrpDestinationTag).not.toBe("123");
    expect(r.fields.solMemoString).toBeNull();
  });

  it("issues a Solana memo", async () => {
    getBalanceSnapshot.mockResolvedValue(0);
    const r = await resolveAssignment({
      ...base,
      chain: "sol",
      token: "usdc",
      amount: { crypto: 5 },
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.fields.solMemoString).toMatch(/^[0-9a-f]{8}$/);
  });

  // 2026-10-14: a Solana address saved as an XRP wallet (before address
  // validation existed) read as balance 0, and sessions opened on it.
  it("refuses a wallet whose address isn't valid on its chain, before any chain read", async () => {
    findWallet.mockResolvedValue({ address: VALID_ADDRESS.sol, isActive: true, merchant: { isActive: true } });
    const r = await resolveAssignment({
      ...base,
      chain: "xrp",
      token: "xrp",
      amount: { crypto: 5 },
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(getBalanceSnapshot).not.toHaveBeenCalled();
  });

  it("refuses to bind an open checkout of a suspended merchant", async () => {
    findWallet.mockResolvedValue({ address: VALID_ADDRESS.eth, isActive: true, merchant: { isActive: false } });
    const r = await resolveAssignment({ ...base, chain: "eth", token: "eth", amount: { crypto: 1 } });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(getBalanceSnapshot).not.toHaveBeenCalled();
  });

  it("refuses checkout step 2 while the merchant has overdue fees", async () => {
    findWallet.mockResolvedValue({
      address: VALID_ADDRESS.eth,
      isActive: true,
      merchant: { isActive: true, billingHoldAt: new Date("2026-11-01T00:00:00Z") },
    });
    const r = await resolveAssignment({ ...base, chain: "eth", token: "eth", amount: { crypto: 1 } });
    expect(r).toMatchObject({ ok: false, status: 403, error: BILLING_HOLD_MESSAGE });
    expect(BILLING_HOLD_MESSAGE).toMatch(/suspended.*contact the merchant/i);
    expect(getBalanceSnapshot).not.toHaveBeenCalled();
  });

  it("skips the chain read for test sessions", async () => {
    const r = await resolveAssignment({
      ...base,
      chain: "eth",
      token: "eth",
      amount: { crypto: 1 },
      isTest: true,
    });
    expect(r).toMatchObject({ ok: true, fields: { balanceSnapshot: 0 } });
    expect(getBalanceSnapshot).not.toHaveBeenCalled();
  });
});

describe("commitAssignment", () => {
  const fields = {
    chain: "eth",
    token: "eth",
    walletAddress: "0xwallet",
    balanceSnapshot: 1,
    snapshotAt: new Date("2026-09-30T00:00:00Z"),
    snapshotBasis: null,
    expectedAmount: 0.5,
    xrpDestinationTag: null,
    solMemoString: null,
  };

  it("re-checks the guard in the WHERE clause", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await commitAssignment("p1", null, fields, {})).toBe(true);
    const { where } = updateMany.mock.calls[0][0];
    expect(where).toMatchObject({
      id: "p1",
      status: "pending",
      receivedAmount: null,
      firstDetectedAt: null,
      txHash: null,
      chain: null,
    });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("reports a lost race as not committed", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await commitAssignment("p1", null, fields, {})).toBe(false);
  });
});
