import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));

import { DEFAULT_FEE_SCHEDULE } from "./fee-schedule";
import { statementOutcome } from "./statements";

const schedule = { ...DEFAULT_FEE_SCHEDULE, minInvoiceUsd: 10, monthlyInvoiceUsd: 100, monthlyCapUsd: 300 };

describe("statementOutcome", () => {
  it("carries a month below the minimum instead of invoicing it", () => {
    expect(statementOutcome(schedule, 1_000, 0, 3)).toMatchObject({ feeUsd: 3.5, amountDueUsd: 3.5, invoice: false });
  });

  it("carries a balance over the minimum until its third billing month", () => {
    expect(statementOutcome(schedule, 1_000, 7, 2)).toMatchObject({ amountDueUsd: 10.5, invoice: false });
    expect(statementOutcome(schedule, 1_000, 7, 3)).toMatchObject({ amountDueUsd: 10.5, invoice: true });
  });

  it("invoices at the month's close once carried balances reach the monthly threshold", () => {
    expect(statementOutcome(schedule, 40_000, 15, 2)).toMatchObject({ feeUsd: 100, amountDueUsd: 115, invoice: true });
  });

  it("caps the month's fee but not what was carried in", () => {
    expect(statementOutcome(schedule, 10_000_000, 4.5, 1)).toMatchObject({
      feeUsd: 300,
      amountDueUsd: 304.5,
      invoice: true,
    });
  });

  it("never invoices nothing", () => {
    expect(statementOutcome({ ...schedule, minInvoiceUsd: 0 }, 0, 0, 12).invoice).toBe(false);
  });
});
