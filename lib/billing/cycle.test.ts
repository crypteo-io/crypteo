import { describe, expect, it } from "vitest";
import {
  anchorDayOf, cycleContaining, cycleLabel, invoicePeriodLabel, lastCompletedCycle, monthsSpanned, ordinal,
} from "./cycle";

const d = (iso: string) => new Date(iso);

describe("billing cycles", () => {
  it("runs from the merchant's own anchor day to the same day next month", () => {
    const anchor = anchorDayOf(d("2026-03-17T15:42:00Z"));
    expect(anchor).toBe(17);
    expect(cycleContaining(anchor, d("2026-10-20T00:00:00Z"))).toEqual({
      start: d("2026-10-17T00:00:00Z"),
      end: d("2026-11-17T00:00:00Z"),
    });
    // Before the anchor day, the cycle started last month.
    expect(cycleContaining(anchor, d("2026-10-04T12:00:00Z")).start).toEqual(d("2026-09-17T00:00:00Z"));
  });

  it("puts a late anchor on the last day of short months", () => {
    expect(cycleContaining(31, d("2026-02-28T10:00:00Z"))).toEqual({
      start: d("2026-02-28T00:00:00Z"),
      end: d("2026-03-31T00:00:00Z"),
    });
    expect(cycleContaining(30, d("2028-02-29T01:00:00Z")).start).toEqual(d("2028-02-29T00:00:00Z"));
  });

  it("closes the cycle that just ended, across a year end", () => {
    expect(lastCompletedCycle(4, d("2027-01-04T00:30:00Z"))).toEqual({
      start: d("2026-12-04T00:00:00Z"),
      end: d("2027-01-04T00:00:00Z"),
    });
    // Different merchants close on different days.
    expect(lastCompletedCycle(17, d("2027-01-04T00:30:00Z")).end).toEqual(d("2026-12-17T00:00:00Z"));
  });

  it("counts billing months between cycle boundaries, short months and year ends included", () => {
    expect(monthsSpanned(d("2026-11-17T00:00:00Z"), d("2027-02-17T00:00:00Z"))).toBe(3);
    // On a 31st anchor, Jan 31 → Apr 30 is three billing months in 89 days.
    expect(monthsSpanned(d("2027-01-31T00:00:00Z"), d("2027-04-30T00:00:00Z"))).toBe(3);
    expect(monthsSpanned(d("2027-01-31T00:00:00Z"), d("2027-02-28T00:00:00Z"))).toBe(1);
  });

  it("labels an invoice from its oldest carried month", () => {
    const own = { periodStart: "2027-01-17T00:00:00Z", periodEnd: "2027-02-17T00:00:00Z" };
    expect(invoicePeriodLabel({ ...own, accruingSince: null })).toBe("Jan 17 – Feb 17, 2027");
    expect(invoicePeriodLabel({ ...own, accruingSince: "2026-11-17T00:00:00Z" })).toBe("Nov 17, 2026 – Feb 17, 2027");
  });

  it("labels a cycle and its anchor day", () => {
    expect(cycleLabel("2026-12-17T00:00:00Z", "2027-01-17T00:00:00Z")).toBe("Dec 17, 2026 – Jan 17, 2027");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "31st",
    ]);
  });
});
