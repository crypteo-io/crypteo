import { prisma } from "../db";
import { DEFAULT_FEE_SCHEDULE, parseFeeTiers, type FeeSchedule } from "./fee-schedule";

export const PLATFORM_SETTINGS_ID = "platform";

export interface PlatformSettings {
  schedule: FeeSchedule;
  billingEnabled: boolean;
  feesStartAt: Date | null;
  billingMerchantId: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const DEFAULTS: PlatformSettings = {
  schedule: DEFAULT_FEE_SCHEDULE,
  billingEnabled: false,
  feesStartAt: null,
  billingMerchantId: null,
  updatedAt: null,
  updatedBy: null,
};

// The landing page reads the schedule on every request; a short in-process
// cache keeps that to one row read per process per window. The admin save
// clears it in the app process, so the editor sees its change at once; other
// processes (the worker) pick it up within the window.
const SETTINGS_CACHE_MS = 30_000;
let cached: { at: number; value: PlatformSettings } | null = null;

export function clearPlatformSettingsCache() {
  cached = null;
}

export async function getPlatformSettings(
  opts: { fresh?: boolean } = {},
): Promise<PlatformSettings> {
  if (!opts.fresh && cached && Date.now() - cached.at < SETTINGS_CACHE_MS) {
    return cached.value;
  }
  const row = await prisma.platformSettings.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
  });
  const value: PlatformSettings = row
    ? {
        schedule: {
          tiers: parseFeeTiers(row.feeTiers),
          monthlyCapUsd: row.feeMonthlyCapUsd,
          minInvoiceUsd: row.feeMinInvoiceUsd,
          monthlyInvoiceUsd: row.feeMonthlyInvoiceUsd,
          invoiceEveryMonths: row.feeInvoiceEveryMonths,
        },
        billingEnabled: row.billingEnabled,
        feesStartAt: row.feesStartAt,
        billingMerchantId: row.billingMerchantId,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      }
    : DEFAULTS;
  cached = { at: Date.now(), value };
  return value;
}

/**
 * The public site's fee schedule. A database outage must not take the
 * landing page down with it: show the last schedule this process read, and
 * the defaults only when it never read one.
 */
export async function getPublicFeeSchedule(): Promise<FeeSchedule> {
  try {
    return (await getPlatformSettings()).schedule;
  } catch (error) {
    console.error("[billing] fee schedule unavailable:", error);
    return cached?.value.schedule ?? DEFAULT_FEE_SCHEDULE;
  }
}
