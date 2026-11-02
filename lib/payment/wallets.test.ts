import { describe, expect, it } from "vitest";
import { offerableWallets, sessionTokenRefusal, sessionWallets } from "./wallets";

const SOL = "ACTceHEAZYvx4kaukH5aByWo1ckf6Nh9R2iG27XSkN5D";
const XRP = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

describe("offerableWallets", () => {
  // 2026-10-14: this Solana address was the merchant's "XRP wallet", saved
  // before address validation existed, and buyers were offered XRP on it.
  it("never offers a wallet whose address isn't valid on its chain", () => {
    expect(
      offerableWallets([
        { chain: "xrp", token: "xrp", address: SOL },
        { chain: "sol", token: "usdc", address: SOL },
      ]).map((w) => w.chain),
    ).toEqual(["sol"]);
  });

  it("normalises case and keeps one wallet per chain/token", () => {
    expect(
      offerableWallets([
        { chain: "XRP", token: "XRP", address: XRP, xrpTag: "" },
        { chain: "xrp", token: "xrp", address: XRP, xrpTag: "7" },
      ]),
    ).toEqual([{ chain: "xrp", token: "xrp", address: XRP, xrpTag: null }]);
  });
});

describe("fee checkout sessions", () => {
  const wallets = [
    { chain: "eth", token: "eth", address: "a", xrpTag: null },
    { chain: "eth", token: "usdt", address: "b", xrpTag: null },
    { chain: "sol", token: "usdc", address: "c", xrpTag: null },
  ];

  it("offer only USDT and USDC on a platform fee checkout", () => {
    expect(sessionWallets(wallets, { feeForStatementId: "s1" }).map((w) => w.token)).toEqual(["usdt", "usdc"]);
    expect(sessionWallets(wallets, { feeForStatementId: null })).toHaveLength(3);
  });

  it("refuse a volatile token on a fee checkout", () => {
    expect(sessionTokenRefusal({ feeForStatementId: "s1" }, "ETH")).toMatch(/USDT or USDC/);
    expect(sessionTokenRefusal({ feeForStatementId: "s1" }, "usdc")).toBeNull();
    expect(sessionTokenRefusal({ feeForStatementId: null }, "eth")).toBeNull();
  });
});
