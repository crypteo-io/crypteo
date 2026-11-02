import { describe, expect, it } from "vitest";
import { CHAIN_BLOCK_TIME_MS, requiredConfirmations } from "./config";
import { getAdapter, isSupportedPair } from "./registry";

// The pairs the product actually sells (app/docs, WalletsClient, playground).
// Every one of these must be watchable by an adapter — a pair we offer but
// cannot detect takes the buyer's money and expires the session unpaid, which
// is exactly how Solana USDC deposits were being lost.
const OFFERED_PAIRS: [string, string][] = [
  ["eth", "eth"],
  ["eth", "usdc"],
  ["eth", "usdt"],
  ["sol", "sol"],
  ["sol", "usdc"],
  ["sol", "usdt"],
  ["btc", "btc"],
  ["xrp", "xrp"],
  ["bsc", "bnb"],
  ["bsc", "usdc"],
  ["bsc", "usdt"],
  ["polygon", "pol"],
  ["polygon", "usdc"],
  ["polygon", "usdt"],
  ["tron", "trx"],
  ["tron", "usdt"],
  ["doge", "doge"],
  ["zec", "zec"],
  ["ada", "ada"],
];

describe("isSupportedPair", () => {
  it.each(OFFERED_PAIRS)(
    "supports the offered pair %s/%s",
    (chain, token) => {
      expect(isSupportedPair(chain, token)).toBe(true);
    },
  );

  it("is case-insensitive, since chain/token inputs are normalized late", () => {
    expect(isSupportedPair("SOL", "USDC")).toBe(true);
    expect(isSupportedPair("Eth", "UsDt")).toBe(true);
  });

  it("rejects a token that isn't issued on that chain", () => {
    expect(isSupportedPair("btc", "usdc")).toBe(false);
    expect(isSupportedPair("xrp", "usdc")).toBe(false);
    expect(isSupportedPair("eth", "sol")).toBe(false);
    // Circle discontinued USDC on Tron; a session nobody can pay is refused.
    expect(isSupportedPair("tron", "usdc")).toBe(false);
    // Each EVM chain accepts its own native token only.
    expect(isSupportedPair("bsc", "eth")).toBe(false);
    expect(isSupportedPair("polygon", "bnb")).toBe(false);
    expect(isSupportedPair("eth", "pol")).toBe(false);
    expect(isSupportedPair("doge", "usdt")).toBe(false);
  });

  it("rejects an unknown chain", () => {
    expect(isSupportedPair("dogecoin", "doge")).toBe(false);
  });
});

describe("adapter registry", () => {
  it.each(["eth", "btc", "sol", "xrp", "bsc", "polygon", "tron", "doge", "zec", "ada"])("resolves the %s adapter", (chain) => {
    expect(getAdapter(chain)?.chain).toBe(chain);
  });

  it("declares every token it claims to support with a real adapter", () => {
    for (const [chain, token] of OFFERED_PAIRS) {
      const adapter = getAdapter(chain);
      expect(adapter, `no adapter for ${chain}`).toBeDefined();
      expect(
        adapter!.supportedTokens.map((t) => t.toLowerCase()),
        `${chain} adapter does not list ${token}`,
      ).toContain(token);
    }
  });
});

describe("per-chain timing", () => {
  const chains = [...new Set(OFFERED_PAIRS.map(([chain]) => chain))];

  // Without a block time, confirmationsFromAge is always 0: a deposit with no
  // resolvable hash never confirms, and settleUnseenConfirming never settles a
  // swept one — both sit in "confirming" until the 24h timeout.
  it.each(chains)("%s has a block time", (chain) => {
    expect(CHAIN_BLOCK_TIME_MS[chain]).toBeGreaterThan(0);
  });

  it.each(chains)(
    "%s reaches its confirmation requirement well inside the 24h confirming timeout",
    (chain) => {
      const ms = requiredConfirmations(chain) * CHAIN_BLOCK_TIME_MS[chain];
      expect(ms).toBeLessThan(6 * 60 * 60_000);
    },
  );
});
