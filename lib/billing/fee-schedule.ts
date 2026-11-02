// The platform fee schedule: one pure module shared by billing (the worker's
// month close), the admin settings form and every fee figure on the public
// site, so what the site advertises is what merchants are charged. Safe to
// import from client components: no database access here.
import { z } from "zod";

export interface FeeTier {
  /** The month's paid volume (USD) from which this rate applies. */
  fromUsd: number;
  percent: number;
}

export interface FeeSchedule {
  tiers: FeeTier[];
  /** Most one merchant is charged for one month; null = uncapped. */
  monthlyCapUsd: number | null;
  /** Nothing is invoiced until the amount owed reaches this; below it, it carries forward. */
  minInvoiceUsd: number;
  /**
   * Owed at or above this is invoiced at that month's close; below it (and
   * above the minimum) it is invoiced every invoiceEveryMonths. null =
   * always every invoiceEveryMonths.
   */
  monthlyInvoiceUsd: number | null;
  /**
   * Below the monthly threshold, how many billing months fees accrue before
   * they're invoiced (3 ≈ 90 days). Counted in billing months, not days:
   * three months from Jan 31 are 89 days, and a strict 90 would wait a fourth.
   */
  invoiceEveryMonths: number;
}

export const MAX_INVOICE_EVERY_MONTHS = 12;
/** Days a merchant has to pay an invoice before checkouts are blocked. */
export const FEE_DUE_DAYS = 7;
export const MAX_FEE_TIERS = 10;
/** A fee above this is a typo, not a price (5% = 500 bps). */
export const MAX_FEE_PERCENT = 5;

/** Starter, Growth and Scale (0.1–0.35%); migration 20261102090000_fee_schedule_v2 moved untouched rows to it. */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  tiers: [
    { fromUsd: 0, percent: 0.35 },
    { fromUsd: 10_000, percent: 0.25 },
    { fromUsd: 50_000, percent: 0.1 },
  ],
  monthlyCapUsd: null,
  minInvoiceUsd: 10,
  monthlyInvoiceUsd: 100,
  invoiceEveryMonths: 3,
};

const money = z.number().min(0).max(1_000_000_000);

export const feeTiersSchema = z
  .array(
    z.object({
      fromUsd: money,
      percent: z.number().min(0).max(MAX_FEE_PERCENT),
    }),
  )
  .min(1, "Add at least one fee tier")
  .max(MAX_FEE_TIERS, `At most ${MAX_FEE_TIERS} fee tiers`)
  .refine((t) => t[0]?.fromUsd === 0, {
    message: "The first tier must start at $0",
  })
  .refine((t) => t.every((tier, i) => i === 0 || tier.fromUsd > t[i - 1].fromUsd), {
    message: "Tiers must start at increasing volumes",
  });

/**
 * A stored tiers value, or the default when it is unreadable. A malformed row
 * must not take the landing page down; the admin form rejects one on save.
 */
export function parseFeeTiers(value: unknown): FeeTier[] {
  const parsed = feeTiersSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_FEE_SCHEDULE.tiers;
}

/** The rate for a month with this paid volume: the highest tier it reaches. */
export function rateForVolume(tiers: readonly FeeTier[], volumeUsd: number): number {
  let rate = tiers[0]?.percent ?? 0;
  for (const t of tiers) if (volumeUsd >= t.fromUsd) rate = t.percent;
  return rate;
}

export const roundCents = (usd: number) => Math.round(usd * 100) / 100;

/** One month's fee: one rate on the whole volume, then the monthly cap. */
export function monthlyFee(
  schedule: Pick<FeeSchedule, "tiers" | "monthlyCapUsd">,
  volumeUsd: number,
): { ratePercent: number; feeUsd: number } {
  const ratePercent = rateForVolume(schedule.tiers, volumeUsd);
  let feeUsd = roundCents((volumeUsd * ratePercent) / 100);
  if (schedule.monthlyCapUsd != null) feeUsd = Math.min(feeUsd, schedule.monthlyCapUsd);
  return { ratePercent, feeUsd };
}

/**
 * Whether an amount owed, accrued over this many billing months, is invoiced
 * now: never below the minimum, at once from the monthly threshold, else
 * once it has accrued for invoiceEveryMonths.
 */
export function shouldInvoice(
  schedule: Pick<FeeSchedule, "minInvoiceUsd" | "monthlyInvoiceUsd" | "invoiceEveryMonths">,
  amountDueUsd: number,
  monthsAccrued: number,
): boolean {
  if (amountDueUsd <= 0 || amountDueUsd < schedule.minInvoiceUsd) return false;
  if (schedule.monthlyInvoiceUsd != null && amountDueUsd >= schedule.monthlyInvoiceUsd) return true;
  return monthsAccrued >= schedule.invoiceEveryMonths;
}

/** "0.15", "0.3", "1" — no trailing zeros. */
function formatPercent(percent: number): string {
  return String(Number(percent.toFixed(4)));
}

export function formatUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(usd) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The figures the public site prints, derived from the schedule. */
export interface FeeCopy {
  lowest: string;
  highest: string;
  /** "0.1–0.35%", or "0.3%" for a flat fee. */
  range: string;
  isTiered: boolean;
  /** Bar width (0–100) against a 2.9% card fee, for the comparison chart. */
  barPercent: number;
  tiers: { fromUsd: number; percent: string }[];
  /**
   * Every rate is below the 1% where competing processors start, so "lowest
   * fees" copy is true. An admin can set any rate; the claim follows it.
   */
  competitive: boolean;
  monthlyCap: string | null;
  /** When fees are invoiced, in one sentence for the site and the Billing page. */
  invoicing: string;
}

const CARD_FEE_PERCENT = 2.9;
const COMPETITOR_MIN_PERCENT = 1;

export function feeCopy(schedule: FeeSchedule): FeeCopy {
  const rates = schedule.tiers.map((t) => t.percent);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const lowest = formatPercent(min);
  const highest = formatPercent(max);
  return {
    lowest,
    highest,
    range: min === max ? `${lowest}%` : `${lowest}–${highest}%`,
    isTiered: min !== max,
    competitive: max < COMPETITOR_MIN_PERCENT,
    barPercent: Math.max(4, Math.min(100, Math.round((max / CARD_FEE_PERCENT) * 100))),
    tiers: schedule.tiers.map((t) => ({ fromUsd: t.fromUsd, percent: formatPercent(t.percent) })),
    monthlyCap: schedule.monthlyCapUsd != null ? formatUsd(schedule.monthlyCapUsd) : null,
    invoicing: invoicingSentence(schedule),
  };
}

function invoicingSentence(schedule: FeeSchedule): string {
  const threshold = schedule.minInvoiceUsd > 0 ? ` once they reach ${formatUsd(schedule.minInvoiceUsd)}` : "";
  const monthly =
    schedule.monthlyInvoiceUsd != null
      ? `, or at the end of the billing month when they reach ${formatUsd(schedule.monthlyInvoiceUsd)}`
      : "";
  const n = schedule.invoiceEveryMonths;
  const every = n === 1 ? "at the end of each billing month" : `every ${n} billing months (about ${n * 30} days)`;
  return `Fees are invoiced ${every}${threshold}${n === 1 ? "" : monthly}; until then they carry forward.`;
}
