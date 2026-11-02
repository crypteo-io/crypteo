import { describe, expect, it } from "vitest";
import { buildPaymentUri } from "./paymentUri";

const ETH_ADDR = "0x1111111111111111111111111111111111111111";

describe("buildPaymentUri", () => {
  it("builds a BIP21 URI for BTC without exponent notation", () => {
    expect(
      buildPaymentUri({ chain: "btc", token: "btc", address: "bc1qxyz", amount: 5e-7 }),
    ).toBe("bitcoin:bc1qxyz?amount=0.0000005");
  });

  it("encodes native ETH value as integer wei", () => {
    expect(
      buildPaymentUri({ chain: "eth", token: "eth", address: ETH_ADDR, amount: 0.001234 }),
    ).toBe(`ethereum:${ETH_ADDR}@1?value=1234000000000000`);
  });

  it("does not leak float error into wei", () => {
    // 0.1 + 0.2 = 0.30000000000000004 as a double.
    expect(
      buildPaymentUri({ chain: "eth", token: "eth", address: ETH_ADDR, amount: 0.1 + 0.2 }),
    ).toBe(`ethereum:${ETH_ADDR}@1?value=300000000000000000`);
    expect(
      buildPaymentUri({ chain: "eth", token: "eth", address: ETH_ADDR, amount: 0.3 }),
    ).toBe(`ethereum:${ETH_ADDR}@1?value=300000000000000000`);
  });

  it("builds an ERC-20 transfer against the token contract", () => {
    expect(
      buildPaymentUri({ chain: "eth", token: "usdc", address: ETH_ADDR, amount: 12.5 }),
    ).toBe(
      `ethereum:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48@1/transfer?address=${ETH_ADDR}&uint256=12500000`,
    );
  });

  it("builds a Solana Pay URI with SPL mint and memo", () => {
    expect(
      buildPaymentUri({
        chain: "sol",
        token: "usdt",
        address: "SoLAddr",
        amount: 3,
        solMemo: "abc 1",
      }),
    ).toBe(
      "solana:SoLAddr?amount=3&spl-token=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB&memo=abc+1",
    );
    expect(
      buildPaymentUri({ chain: "sol", token: "sol", address: "SoLAddr", amount: 1e-9 }),
    ).toBe("solana:SoLAddr?amount=0.000000001");
  });

  it("falls back to the bare address for XRP, unknown tokens and missing amounts", () => {
    expect(
      buildPaymentUri({ chain: "xrp", token: "xrp", address: "rXRP", amount: 10 }),
    ).toBe("rXRP");
    expect(
      buildPaymentUri({ chain: "eth", token: "dai", address: ETH_ADDR, amount: 10 }),
    ).toBe(ETH_ADDR);
    expect(
      buildPaymentUri({ chain: "btc", token: "btc", address: "bc1q", amount: null }),
    ).toBe("bc1q");
  });

  it("names the right chain id for BSC and Polygon natives", () => {
    expect(
      buildPaymentUri({ chain: "bsc", token: "bnb", address: ETH_ADDR, amount: 0.5 }),
    ).toBe(`ethereum:${ETH_ADDR}@56?value=500000000000000000`);
    expect(
      buildPaymentUri({ chain: "polygon", token: "pol", address: ETH_ADDR, amount: 2 }),
    ).toBe(`ethereum:${ETH_ADDR}@137?value=2000000000000000000`);
  });

  it("encodes BEP-20 amounts at 18 decimals, not Ethereum's 6", () => {
    expect(
      buildPaymentUri({ chain: "bsc", token: "usdt", address: ETH_ADDR, amount: 12.5 }),
    ).toBe(
      `ethereum:0x55d398326f99059fF775485246999027B3197955@56/transfer?address=${ETH_ADDR}&uint256=12500000000000000000`,
    );
  });

  it("encodes Polygon USDC against the native contract at 6 decimals", () => {
    expect(
      buildPaymentUri({ chain: "polygon", token: "usdc", address: ETH_ADDR, amount: 12.5 }),
    ).toBe(
      `ethereum:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359@137/transfer?address=${ETH_ADDR}&uint256=12500000`,
    );
  });

  it("does not offer another chain's native token as an EVM value transfer", () => {
    expect(
      buildPaymentUri({ chain: "bsc", token: "eth", address: ETH_ADDR, amount: 1 }),
    ).toBe(ETH_ADDR);
  });

  it("builds Dogecoin and Zcash URIs", () => {
    expect(
      buildPaymentUri({ chain: "doge", token: "doge", address: "DAddr", amount: 1e-7 }),
    ).toBe("dogecoin:DAddr?amount=0.0000001");
    expect(
      buildPaymentUri({ chain: "zec", token: "zec", address: "t1Addr", amount: 0.25 }),
    ).toBe("zcash:t1Addr?amount=0.25");
  });

  it("falls back to the bare address for Tron and Cardano", () => {
    expect(
      buildPaymentUri({ chain: "tron", token: "usdt", address: "TAddr", amount: 10 }),
    ).toBe("TAddr");
    expect(
      buildPaymentUri({ chain: "ada", token: "ada", address: "addr1x", amount: 10 }),
    ).toBe("addr1x");
  });
});
