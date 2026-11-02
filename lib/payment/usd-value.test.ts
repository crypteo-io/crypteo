import { describe, expect, it } from "vitest";
import { ORIGINAL_USD_KEY } from "./assign";
import { KNOWN_USD_SQL, knownUsdValue } from "./usd-value";

describe("knownUsdValue", () => {
  it("prefers the recorded USD price, then a stablecoin amount, else unknown", () => {
    expect(knownUsdValue({ token: "eth", expectedAmount: 0.01, metadata: { originalUsdAmount: 42 } })).toBe(42);
    expect(knownUsdValue({ token: "USDT", expectedAmount: 12, metadata: null })).toBe(12);
    expect(knownUsdValue({ token: "btc", expectedAmount: 0.001, metadata: {} })).toBeNull();
  });

  it("ignores a recorded value that isn't a positive JSON number", () => {
    expect(knownUsdValue({ token: "sol", expectedAmount: 1, metadata: { originalUsdAmount: "9" } })).toBeNull();
    expect(knownUsdValue({ token: "usdc", expectedAmount: 5, metadata: { originalUsdAmount: 0 } })).toBe(5);
  });

  it("the SQL twin reads the same metadata key", () => {
    expect(ORIGINAL_USD_KEY).toBe("originalUsdAmount");
    expect(KNOWN_USD_SQL.sql).toContain(`'${ORIGINAL_USD_KEY}'`);
    expect(KNOWN_USD_SQL.sql).toContain("'usdc', 'usdt'");
  });
});
