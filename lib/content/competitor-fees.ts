// Other gateways' published merchant fees, for the pricing calculator
// (components/site/FeeCalculator.tsx). Checked 2026-11-14 against:
//   Coinbase Business: 1% of each completed payment, from Coinbase's
//     announcement of its Business payment tools and its Commerce-to-Business
//     transition page (Commerce closed to new charges on 2026-03-31). Business
//     takes stablecoins only (USDC, USDT) and shows the current rate in the
//     account, so recheck it there when updating.
//   CoinPayments: coinpayments.net/help-fees, "Starting at 3% Fee" for coins and tokens.
//   BitPay: bitpay.com/pricing, 2% + 25¢ under $500,000 a month, 1.5% + 25¢
//     to $999,999, 1% + 25¢ from $1,000,000, on cumulative monthly volume.
// Update the figures and CHECKED_ON together.

import { rateForVolume, roundCents, type FeeTier } from "@/lib/billing/fee-schedule";

export const CHECKED_ON = "November 2026";

/** BitPay's fixed fee is per payment, so its monthly cost depends on how many payments make up the volume. */
export const ASSUMED_ORDER_USD = 100;

export interface Competitor {
  name: string;
  /** The provider lists its rate as a starting rate. */
  startingRate?: boolean;
  tiers: FeeTier[];
  perPaymentUsd: number;
}

export const COMPETITORS: Competitor[] = [
  { name: "Coinbase Business", tiers: [{ fromUsd: 0, percent: 1 }], perPaymentUsd: 0 },
  { name: "CoinPayments", startingRate: true, tiers: [{ fromUsd: 0, percent: 3 }], perPaymentUsd: 0 },
  {
    name: "BitPay",
    tiers: [
      { fromUsd: 0, percent: 2 },
      { fromUsd: 500_000, percent: 1.5 },
      { fromUsd: 1_000_000, percent: 1 },
    ],
    perPaymentUsd: 0.25,
  },
];

/** A month's fee at a competitor: the rate its volume reaches, plus any per-payment fee on ASSUMED_ORDER_USD orders. */
export function competitorMonthlyFee(c: Competitor, volumeUsd: number): number {
  const percent = rateForVolume(c.tiers, volumeUsd);
  const payments = Math.ceil(volumeUsd / ASSUMED_ORDER_USD);
  return roundCents((volumeUsd * percent) / 100 + payments * c.perPaymentUsd);
}

/** The rate that applies at this volume, as the provider states it: "from 3%", "1.5% + 25¢". */
export function competitorRate(c: Competitor, volumeUsd: number): string {
  const fixed = c.perPaymentUsd > 0 ? ` + ${Math.round(c.perPaymentUsd * 100)}¢` : "";
  return `${c.startingRate ? "from " : ""}${rateForVolume(c.tiers, volumeUsd)}%${fixed}`;
}
