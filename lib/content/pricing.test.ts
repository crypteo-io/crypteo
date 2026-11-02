import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCHEDULE, feeCopy } from "@/lib/billing/fee-schedule";
import { pricingTiers } from "./pricing";

describe("pricingTiers", () => {
  it("prints the billed schedule's rates and boundaries", () => {
    const tiers = pricingTiers(feeCopy(DEFAULT_FEE_SCHEDULE));
    expect(tiers.map((t) => [t.name, t.rate, t.volume])).toEqual([
      ["Starter", "0.35%", "Under $10,000 / month"],
      ["Growth", "0.25%", "$10,000 – $50,000 / month"],
      ["Scale", "0.1%", "$50,000+ / month"],
    ]);
  });

  it("follows whatever the admin sets, including a flat fee", () => {
    const flat = pricingTiers(feeCopy({ ...DEFAULT_FEE_SCHEDULE, tiers: [{ fromUsd: 0, percent: 0.5 }] }));
    expect(flat).toEqual([expect.objectContaining({ rate: "0.5%", volume: "Any monthly volume" })]);
  });
});
