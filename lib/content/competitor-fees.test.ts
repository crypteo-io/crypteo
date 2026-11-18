import { describe, expect, it } from "vitest";
import { COMPETITORS, competitorMonthlyFee, competitorRate } from "./competitor-fees";

const byName = (name: string) => {
  const c = COMPETITORS.find((x) => x.name === name);
  if (!c) throw new Error(name);
  return c;
};

describe("competitorMonthlyFee", () => {
  it("charges a flat rate on the month's volume", () => {
    expect(competitorMonthlyFee(byName("Coinbase Business"), 2000)).toBe(20);
    expect(competitorMonthlyFee(byName("CoinPayments"), 2000)).toBe(60);
  });

  it("adds BitPay's per-payment fee on assumed $100 orders and steps its rate down with volume", () => {
    expect(competitorMonthlyFee(byName("BitPay"), 2000)).toBe(45);
    expect(competitorMonthlyFee(byName("BitPay"), 500_000)).toBe(7500 + 1250);
    expect(competitorMonthlyFee(byName("BitPay"), 1_000_000)).toBe(10_000 + 2500);
  });

  it("labels the rate that applies at the volume", () => {
    expect(competitorRate(byName("BitPay"), 2000)).toBe("2% + 25¢");
    expect(competitorRate(byName("BitPay"), 750_000)).toBe("1.5% + 25¢");
    expect(competitorRate(byName("CoinPayments"), 2000)).toBe("from 3%");
  });
});
