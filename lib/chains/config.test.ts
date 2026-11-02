import { describe, expect, it } from "vitest";
import {
  balanceDelta,
  CHAIN_BLOCK_TIME_MS,
  EVM_CHAINS,
  TRON_TOKEN_CONTRACTS,
  classifyAmount,
  confirmationsFromAge,
  CONFIRMATIONS_REQUIRED,
  PAYMENT_TOLERANCE,
  requiredConfirmations,
  shouldRedetectUnderpaid,
} from "./config";

describe("balanceDelta", () => {
  // Production values: balance 13095911247036125 wei, stored snapshot lost its
  // 17th digit, and the unchanged balance read back as a 3.47e-18 ETH deposit.
  const readBalance = parseFloat("0.013095911247036125");
  const storedSnapshot = 0.01309591124703612;

  it("reports an unchanged balance as zero despite a lossy stored snapshot", () => {
    expect(readBalance - storedSnapshot).toBeGreaterThan(0); // the bug
    expect(balanceDelta(readBalance, storedSnapshot)).toBe(0);
  });

  it("keeps a real deposit and strips its float noise", () => {
    expect(balanceDelta(storedSnapshot + 0.001871, storedSnapshot)).toBe(0.001871);
    expect(balanceDelta(0.008928911247036125 + 0.004167, 0.008928911247036125)).toBe(0.004167);
  });

  it("keeps a single wei on a small balance", () => {
    expect(balanceDelta(0.000000000000000002, 0.000000000000000001)).toBe(1e-18);
  });

  it("scales the noise floor with the balance", () => {
    expect(balanceDelta(46.731694 + 5e-15, 46.731694)).toBe(0);
    expect(balanceDelta(46.731694 + 0.000001, 46.731694)).toBe(0.000001);
  });

  it("preserves a negative delta (a sweep) and zero balances", () => {
    expect(balanceDelta(0.5, 1.5)).toBe(-1);
    expect(balanceDelta(0, 0)).toBe(0);
    expect(Object.is(balanceDelta(1, 1), 0)).toBe(true);
  });
});

describe("classifyAmount", () => {
  it("marks an exact payment as confirmed", () => {
    expect(classifyAmount(100, 100)).toBe("confirmed");
  });

  it("marks a clearly larger payment as overpaid", () => {
    expect(classifyAmount(150, 100)).toBe("overpaid");
  });

  it("marks a clearly smaller payment as underpaid", () => {
    expect(classifyAmount(50, 100)).toBe("underpaid");
  });

  it("treats shortfalls within tolerance as confirmed", () => {
    // 99.5% of expected — above the 0.99 confirmed_from floor.
    expect(classifyAmount(99.5, 100)).toBe("confirmed");
  });

  it("treats a shortfall below the tolerance floor as underpaid", () => {
    // 98% — below the 0.99 floor.
    expect(classifyAmount(98, 100)).toBe("underpaid");
  });

  it("honours the exact confirmed_from boundary", () => {
    const expected = 100;
    const atFloor = expected * PAYMENT_TOLERANCE.confirmed_from;
    expect(classifyAmount(atFloor, expected)).toBe("confirmed");
  });

  it("honours the exact overpaid_above boundary", () => {
    const expected = 100;
    const atOver = expected * PAYMENT_TOLERANCE.overpaid_above;
    expect(classifyAmount(atOver, expected)).toBe("overpaid");
  });

  it("classifies just below the overpaid boundary as confirmed", () => {
    const expected = 100;
    const justUnder = expected * PAYMENT_TOLERANCE.overpaid_above - 0.0001;
    expect(classifyAmount(justUnder, expected)).toBe("confirmed");
  });

  it("never auto-confirms against a malformed (non-positive) expected", () => {
    // Guard: a zero/negative expected must not divide to Infinity and slip
    // through as overpaid/confirmed — it should stay underpaid.
    expect(classifyAmount(10, 0)).toBe("underpaid");
    expect(classifyAmount(10, -5)).toBe("underpaid");
    expect(classifyAmount(0, 0)).toBe("underpaid");
  });

  it("respects a merchant's custom confirmed-from threshold", () => {
    // A merchant that accepts 90% completes what the 0.99 default rejects.
    expect(classifyAmount(92, 100, 0.9)).toBe("confirmed");
    expect(classifyAmount(92, 100)).toBe("underpaid");
    // A stricter merchant (99.9%) rejects a 99.5% payment the default accepts.
    expect(classifyAmount(99.5, 100, 0.999)).toBe("underpaid");
  });

  it("ignores a malformed threshold and falls back to the default floor", () => {
    expect(classifyAmount(99.5, 100, 0)).toBe("confirmed");
    expect(classifyAmount(99.5, 100, -1)).toBe("confirmed");
    expect(classifyAmount(98, 100, NaN)).toBe("underpaid");
  });
});

describe("confirmationsFromAge", () => {
  const detected = new Date("2026-01-01T00:00:00.000Z");
  const at = (ms: number) => new Date(detected.getTime() + ms);

  it("reports no confirmations when the deposit was never detected", () => {
    // The unstuck path must not fire for a session that has seen no money.
    expect(confirmationsFromAge("eth", null, at(60 * 60_000))).toBe(0);
    expect(confirmationsFromAge("eth", undefined, at(60 * 60_000))).toBe(0);
  });

  it("derives ETH confirmations from elapsed time at ~12s per block", () => {
    expect(confirmationsFromAge("eth", detected, at(11_000))).toBe(0);
    expect(confirmationsFromAge("eth", detected, at(12_000))).toBe(1);
    expect(confirmationsFromAge("eth", detected, at(144_000))).toBe(12);
  });

  it("clears the ETH confirmation requirement once enough time has passed", () => {
    // The exact condition that unpins a payment stuck in "confirming" with no
    // resolvable tx hash: 12 required confirmations ≈ 2.4 minutes.
    const confs = confirmationsFromAge("eth", detected, at(5 * 60_000));
    expect(confs).toBeGreaterThanOrEqual(CONFIRMATIONS_REQUIRED.eth);
  });

  it("uses each chain's own block time", () => {
    expect(confirmationsFromAge("btc", detected, at(30 * 60_000))).toBe(3);
    expect(confirmationsFromAge("xrp", detected, at(20_000))).toBe(5);
  });

  it("holds Solana to finality time, not slot time", () => {
    // Solana slots are ~400ms, but its single required confirmation means
    // *finalized* (~13s). Deriving from slot time would let a deposit count as
    // final within a second of being seen, undercutting the finality check the
    // adapter performs.
    expect(confirmationsFromAge("sol", detected, at(1_000))).toBe(0);
    expect(confirmationsFromAge("sol", detected, at(5_000))).toBe(0);
    expect(
      confirmationsFromAge("sol", detected, at(13_000)),
    ).toBeGreaterThanOrEqual(requiredConfirmations("sol"));
  });

  it("never reports negative confirmations for a future timestamp", () => {
    expect(confirmationsFromAge("eth", detected, at(-60_000))).toBe(0);
  });

  it("reports nothing for a chain with no known block time", () => {
    expect(confirmationsFromAge("dogecoin", detected, at(60 * 60_000))).toBe(0);
  });
});

describe("requiredConfirmations", () => {
  it("uses the chain requirement, not the token's", () => {
    // Confirmations belong to the chain. Looking up by token alone would give
    // Solana USDC Ethereum's 12-confirmation requirement.
    expect(requiredConfirmations("sol", "usdc")).toBe(1);
    expect(requiredConfirmations("sol", "usdt")).toBe(1);
    expect(requiredConfirmations("sol", "sol")).toBe(1);
  });

  it("keeps Ethereum's requirement across all its tokens", () => {
    expect(requiredConfirmations("eth", "eth")).toBe(12);
    expect(requiredConfirmations("eth", "usdc")).toBe(12);
    expect(requiredConfirmations("eth", "usdt")).toBe(12);
  });

  it("covers the remaining chains", () => {
    expect(requiredConfirmations("btc", "btc")).toBe(3);
    expect(requiredConfirmations("xrp", "xrp")).toBe(1);
  });

  it("gives tokens on the new chains their chain's requirement, not Ethereum's", () => {
    expect(requiredConfirmations("bsc", "usdt")).toBe(30);
    expect(requiredConfirmations("polygon", "usdc")).toBe(64);
    expect(requiredConfirmations("tron", "usdt")).toBe(19);
    expect(requiredConfirmations("tron", "trx")).toBe(19);
    expect(requiredConfirmations("doge")).toBe(6);
    expect(requiredConfirmations("zec")).toBe(10);
    expect(requiredConfirmations("ada")).toBe(15);
  });

  it("is case-insensitive and defaults conservatively", () => {
    expect(requiredConfirmations("BTC")).toBe(3);
    expect(requiredConfirmations("unknown-chain", "unknown-token")).toBe(12);
  });
});

describe("token configuration", () => {
  // Decimals are per chain: BSC's Binance-Peg stablecoins are 18, not 6. A
  // wrong figure misreports every balance by 10^12. Values read from the
  // contracts' decimals() on 2026-10-12.
  it.each([
    ["eth", "usdc", 6],
    ["eth", "usdt", 6],
    ["bsc", "usdc", 18],
    ["bsc", "usdt", 18],
    ["polygon", "usdc", 6],
    ["polygon", "usdt", 6],
  ] as const)("%s %s has %i decimals", (chain, token, decimals) => {
    expect(EVM_CHAINS[chain].tokens[token].decimals).toBe(decimals);
  });

  it("uses Circle-native USDC on Polygon, not bridged USDC.e", () => {
    expect(EVM_CHAINS.polygon.tokens.usdc.contract.toLowerCase()).toBe(
      "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    );
  });

  it("gives every EVM chain a distinct chain id and native token", () => {
    const ids = Object.values(EVM_CHAINS).map((c) => c.chainId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EVM_CHAINS.bsc.chainId).toBe(56);
    expect(EVM_CHAINS.polygon.chainId).toBe(137);
    expect(EVM_CHAINS.bsc.nativeToken).toBe("bnb");
    expect(EVM_CHAINS.polygon.nativeToken).toBe("pol");
  });

  it("lists Tron USDT at 6 decimals", () => {
    expect(TRON_TOKEN_CONTRACTS.usdt).toEqual({
      contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      decimals: 6,
    });
  });

  it("keeps every EVM chain's log-walk window under a day", () => {
    // Confirming sessions time out at 24h; a longer walk is wasted calls.
    for (const [chain, cfg] of Object.entries(EVM_CHAINS)) {
      expect(cfg.maxLogLookbackBlocks * CHAIN_BLOCK_TIME_MS[chain]).toBeLessThanOrEqual(
        24 * 60 * 60_000,
      );
    }
  });
});

describe("shouldRedetectUnderpaid", () => {
  it("never re-detects a confirming session (shared-wallet safety)", () => {
    expect(shouldRedetectUnderpaid("confirming", 0.000001, 10)).toBe(false);
    expect(shouldRedetectUnderpaid("pending", 1, 10)).toBe(false);
  });

  it("re-detects once a short credit has settled as underpaid", () => {
    expect(shouldRedetectUnderpaid("underpaid", 0.000001, 10)).toBe(true);
    expect(shouldRedetectUnderpaid("underpaid", 5, 10)).toBe(true);
  });

  it("keeps re-reporting a credit that covers the invoice", () => {
    expect(shouldRedetectUnderpaid("underpaid", 10, 10)).toBe(false);
    expect(shouldRedetectUnderpaid("confirmed", 10, 10)).toBe(false);
  });

  it("respects the merchant's confirmed-from threshold", () => {
    expect(shouldRedetectUnderpaid("underpaid", 9.6, 10, 0.95)).toBe(false);
    expect(shouldRedetectUnderpaid("underpaid", 9.6, 10, 0.99)).toBe(true);
  });
});
