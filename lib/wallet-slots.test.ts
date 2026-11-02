import { describe, expect, it } from "vitest";
import { getAdapter, isSupportedPair } from "./chains/registry";
import { byWalletOrder, slotKey, WALLET_ASSETS } from "./wallet-slots";

const slots = WALLET_ASSETS.flatMap((a) => a.slots);
const CHAINS = ["eth", "btc", "sol", "xrp", "bsc", "polygon", "tron", "doge", "zec", "ada"];

describe("WALLET_ASSETS", () => {
  it("covers exactly the pairs checkout accepts, once each", () => {
    for (const s of slots) expect(isSupportedPair(s.chain, s.token)).toBe(true);
    const supported = CHAINS.flatMap((c) => getAdapter(c)?.supportedTokens.map((t) => slotKey(c, t)) ?? []);
    expect(new Set(slots.map((s) => slotKey(s.chain, s.token)))).toEqual(new Set(supported));
    expect(new Set(slots.map((s) => slotKey(s.chain, s.token))).size).toBe(slots.length);
  });

  it("lists assets in the agreed order", () => {
    expect(WALLET_ASSETS.map((a) => a.name)).toEqual([
      "Ethereum", "Bitcoin", "USDC", "USDT", "Solana", "BNB Smart Chain",
      "Polygon", "Tron", "XRP", "Dogecoin", "Zcash", "Cardano",
    ]);
  });
});

describe("byWalletOrder", () => {
  it("keeps one asset's networks together and unknown pairs last", () => {
    const sorted = byWalletOrder([
      { chain: "sol", token: "USDC" },
      { chain: "x", token: "y" },
      { chain: "btc", token: "btc" },
      { chain: "sol", token: "sol" },
      { chain: "eth", token: "usdc" },
    ]);
    expect(sorted.map((p) => slotKey(p.chain, p.token))).toEqual(["btc-btc", "eth-usdc", "sol-usdc", "sol-sol", "x-y"]);
  });
});
