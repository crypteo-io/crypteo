import { formatUsd, type FeeCopy } from "@/lib/billing/fee-schedule";

// Pricing copy for the home page, /pricing and the terms. The figures come
// from the admin's fee schedule (lib/billing/fee-schedule.ts feeCopy), the
// same one billing charges, so the site can't advertise a rate it doesn't bill.

export type PricingTier = {
  name: string;
  rate: string;
  volume: string;
  blurb: string;
  featured?: boolean;
};

const NAMED_TIERS = [
  { name: "Starter", blurb: "For new stores and side projects taking their first crypto payments." },
  { name: "Growth", blurb: "For established businesses with steady crypto volume." },
  { name: "Scale", blurb: "For high-volume merchants, platforms and marketplaces." },
];

/** One card per fee tier: "Under $10,000 / month", "$10,000 – $50,000 / month", "$50,000+ / month". */
export function pricingTiers(fees: FeeCopy): PricingTier[] {
  const tiers = fees.tiers;
  return tiers.map((tier, i) => {
    const next = tiers[i + 1];
    const volume =
      tiers.length === 1
        ? "Any monthly volume"
        : i === 0
          ? `Under ${formatUsd(next.fromUsd)} / month`
          : next
            ? `${formatUsd(tier.fromUsd)} – ${formatUsd(next.fromUsd)} / month`
            : `${formatUsd(tier.fromUsd)}+ / month`;
    const named = tiers.length <= NAMED_TIERS.length ? NAMED_TIERS[tiers.length === 1 ? 1 : i] : null;
    return {
      name: named?.name ?? `Tier ${i + 1}`,
      blurb: named?.blurb ?? "Every feature, at this volume's rate.",
      rate: `${tier.percent}%`,
      volume,
      featured: tiers.length > 1 && i === 1,
    };
  });
}

export const PRICING_INCLUDED = [
  "All 10 networks and 12 assets",
  "Hosted checkout and payment links",
  "White label branding",
  "REST API and signed webhooks",
  "Test-mode API keys",
  "Payments straight to your own wallet",
  "No setup fee, no monthly minimum",
];
