import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEE_SCHEDULE,
  feeCopy,
  feeTiersSchema,
  monthlyFee,
  parseFeeTiers,
  rateForVolume,
  shouldInvoice,
} from "./fee-schedule";

const TIERS = [
  { fromUsd: 0, percent: 0.45 },
  { fromUsd: 50_000, percent: 0.3 },
  { fromUsd: 250_000, percent: 0.15 },
];

describe("rateForVolume", () => {
  it("charges the highest tier the month's volume reaches", () => {
    expect(rateForVolume(TIERS, 0)).toBe(0.45);
    expect(rateForVolume(TIERS, 49_999.99)).toBe(0.45);
    expect(rateForVolume(TIERS, 50_000)).toBe(0.3);
    expect(rateForVolume(TIERS, 1_000_000)).toBe(0.15);
  });
});

describe("monthlyFee", () => {
  it("applies one rate to the whole month, rounded to cents", () => {
    expect(monthlyFee({ tiers: TIERS, monthlyCapUsd: null }, 60_000)).toEqual({ ratePercent: 0.3, feeUsd: 180 });
    expect(monthlyFee({ tiers: TIERS, monthlyCapUsd: null }, 123.45).feeUsd).toBe(0.56);
  });

  it("never charges more than the monthly cap", () => {
    expect(monthlyFee({ tiers: TIERS, monthlyCapUsd: 500 }, 1_000_000).feeUsd).toBe(500);
    expect(monthlyFee({ tiers: TIERS, monthlyCapUsd: 500 }, 1_000).feeUsd).toBe(4.5);
  });
});

describe("feeCopy", () => {
  it("prints a range for tiers and a single figure for a flat fee", () => {
    expect(feeCopy(DEFAULT_FEE_SCHEDULE).range).toBe("0.1–0.35%");
    const flat = feeCopy({ tiers: [{ fromUsd: 0, percent: 0.3 }], monthlyCapUsd: 250, minInvoiceUsd: 0, monthlyInvoiceUsd: null, invoiceEveryMonths: 3 });
    expect(flat).toMatchObject({ range: "0.3%", isTiered: false, monthlyCap: "$250" });
    expect(flat.invoicing).toBe(
      "Fees are invoiced every 3 billing months (about 90 days); until then they carry forward.",
    );
  });

  it("prints the default Starter, Growth and Scale rates", () => {
    const copy = feeCopy(DEFAULT_FEE_SCHEDULE);
    expect([copy.lowest, copy.highest, copy.barPercent]).toEqual(["0.1", "0.35", 12]);
    expect(copy.competitive).toBe(true);
    expect(feeCopy({ ...DEFAULT_FEE_SCHEDULE, tiers: [{ fromUsd: 0, percent: 1.5 }] }).competitive).toBe(false);
  });

  it("states both invoicing thresholds and the cadence", () => {
    expect(feeCopy(DEFAULT_FEE_SCHEDULE).invoicing).toBe(
      "Fees are invoiced every 3 billing months (about 90 days) once they reach $10, or at the end of the billing month when they reach $100; until then they carry forward.",
    );
    expect(feeCopy({ ...DEFAULT_FEE_SCHEDULE, invoiceEveryMonths: 1 }).invoicing).toBe(
      "Fees are invoiced at the end of each billing month once they reach $10; until then they carry forward.",
    );
  });
});

describe("shouldInvoice", () => {
  const thresholds = { minInvoiceUsd: 10, monthlyInvoiceUsd: 100, invoiceEveryMonths: 3 };

  it("never invoices below the minimum, however long it has accrued", () => {
    expect(shouldInvoice(thresholds, 9.99, 12)).toBe(false);
    expect(shouldInvoice({ ...thresholds, minInvoiceUsd: 0, monthlyInvoiceUsd: null }, 0, 12)).toBe(false);
  });

  it("invoices from the minimum only every third billing month", () => {
    expect(shouldInvoice(thresholds, 10, 1)).toBe(false);
    expect(shouldInvoice(thresholds, 99.99, 2)).toBe(false);
    expect(shouldInvoice(thresholds, 10, 3)).toBe(true);
    expect(shouldInvoice(thresholds, 10, 5)).toBe(true);
  });

  it("follows the cadence the admin set", () => {
    expect(shouldInvoice({ ...thresholds, invoiceEveryMonths: 6 }, 50, 5)).toBe(false);
    expect(shouldInvoice({ ...thresholds, invoiceEveryMonths: 6 }, 50, 6)).toBe(true);
    expect(shouldInvoice({ ...thresholds, invoiceEveryMonths: 1 }, 10, 1)).toBe(true);
  });

  it("invoices monthly from the monthly threshold", () => {
    expect(shouldInvoice(thresholds, 100, 1)).toBe(true);
    expect(shouldInvoice({ ...thresholds, monthlyInvoiceUsd: null }, 5_000, 1)).toBe(false);
  });
});

describe("fee tiers validation", () => {
  it("requires a first tier at $0 and increasing starts", () => {
    expect(feeTiersSchema.safeParse(TIERS).success).toBe(true);
    expect(feeTiersSchema.safeParse([{ fromUsd: 10, percent: 1 }]).success).toBe(false);
    expect(feeTiersSchema.safeParse([TIERS[0], { fromUsd: 0, percent: 0.2 }]).success).toBe(false);
    expect(feeTiersSchema.safeParse([{ fromUsd: 0, percent: 50 }]).success).toBe(false);
  });

  it("falls back to the defaults on an unreadable stored value", () => {
    expect(parseFeeTiers("nonsense")).toEqual(DEFAULT_FEE_SCHEDULE.tiers);
    expect(parseFeeTiers(TIERS)).toEqual(TIERS);
  });
});
