import { describe, expect, it } from "vitest";
import { formatAmount, toPlainDecimal } from "./format";

describe("formatAmount", () => {
  it("never uses exponent notation", () => {
    expect(formatAmount(5e-7, "btc")).toBe("0.0000005");
    expect(formatAmount(1e-9, "sol")).toBe("0.000000001");
    expect(formatAmount(1e21, "usdc")).not.toMatch(/e/i);
  });

  it("trims trailing zeros and float noise", () => {
    expect(formatAmount(1.5, "eth")).toBe("1.5");
    expect(formatAmount(0.1 + 0.2, "usdc")).toBe("0.3");
    expect(formatAmount(100, "usdt")).toBe("100");
  });

  it("rounds to the token's display precision", () => {
    expect(formatAmount(1.23456789, "usdc")).toBe("1.234568");
    expect(formatAmount(0.123456789123, "btc")).toBe("0.12345679");
  });

  it("does not report a tiny non-zero amount as zero", () => {
    expect(formatAmount(1e-12, "btc")).toBe("<0.00000001");
    expect(formatAmount(-1e-12, "btc")).toBe(">-0.00000001");
  });

  it("accepts an explicit decimals override", () => {
    expect(formatAmount(1.23456, "btc", 2)).toBe("1.23");
  });

  it("handles missing and non-finite values", () => {
    expect(formatAmount(null, "btc")).toBe("0");
    expect(formatAmount(undefined)).toBe("0");
    expect(formatAmount(NaN, "eth")).toBe("0");
    expect(formatAmount(0, "eth")).toBe("0");
  });

  it("falls back to 8 decimals for unknown tokens", () => {
    expect(formatAmount(0.123456789, "doge")).toBe("0.12345679");
  });
});

describe("formatAmount on the newer chains", () => {
  it("uses each native token's precision", () => {
    expect(formatAmount(1.23456789, "trx")).toBe("1.234568");
    expect(formatAmount(1.23456789, "ada")).toBe("1.234568");
    expect(formatAmount(0.000000015, "doge")).toBe("0.00000002");
    expect(formatAmount(0.123456789, "zec")).toBe("0.12345679");
    expect(formatAmount(0.123456789, "bnb")).toBe("0.12345679");
    expect(formatAmount(12.5, "pol")).toBe("12.5");
  });
});

describe("toPlainDecimal", () => {
  it("normalises negative zero", () => {
    expect(toPlainDecimal(-1e-12, 6)).toBe("0");
  });
  it("has no grouping separators", () => {
    expect(toPlainDecimal(1234567.5, 2)).toBe("1234567.5");
  });
});
