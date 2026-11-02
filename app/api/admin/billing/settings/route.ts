import { auditLog, requireAdmin } from "@/lib/admin";
import { feeTiersSchema, MAX_INVOICE_EVERY_MONTHS } from "@/lib/billing/fee-schedule";
import {
  clearPlatformSettingsCache,
  getPlatformSettings,
  PLATFORM_SETTINGS_ID,
} from "@/lib/billing/settings";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const usd = z.number().min(0).max(1_000_000_000);

const schema = z
  .object({
    tiers: feeTiersSchema,
    monthlyCapUsd: usd.gt(0, "The cap must be above $0").nullable(),
    minInvoiceUsd: usd,
    monthlyInvoiceUsd: usd.nullable(),
    invoiceEveryMonths: z
      .number()
      .int("Whole billing months only")
      .min(1, "At least every billing month")
      .max(MAX_INVOICE_EVERY_MONTHS, `At most every ${MAX_INVOICE_EVERY_MONTHS} billing months`),
    billingEnabled: z.boolean(),
    billingMerchantId: z.string().regex(/^[a-z0-9]{20,40}$/).nullable(),
  })
  .refine((v) => v.monthlyInvoiceUsd == null || v.monthlyInvoiceUsd > v.minInvoiceUsd, {
    message: "The monthly threshold must be above the minimum",
    path: ["monthlyInvoiceUsd"],
  });

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;
  return NextResponse.json(await getPlatformSettings({ fresh: true }));
}

/**
 * Save the fee schedule and billing switches. The same schedule prints on the
 * public site, so the landing and terms pages are revalidated with it.
 */
export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid request", field: issue?.path[0] },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    if (input.billingMerchantId) {
      const account = await prisma.merchant.findUnique({
        where: { id: input.billingMerchantId },
        select: { isActive: true, role: true },
      });
      if (!account?.isActive || account.role !== "admin") {
        return NextResponse.json(
          { error: "The billing account must be an active admin account", field: "billingMerchantId" },
          { status: 400 },
        );
      }
    }
    if (input.billingEnabled && !input.billingMerchantId) {
      return NextResponse.json(
        { error: "Choose the account that receives fee payments before turning billing on", field: "billingMerchantId" },
        { status: 400 },
      );
    }

    const current = await getPlatformSettings({ fresh: true });
    // Fees count from the moment billing is switched on, never from a
    // merchant's whole history, and never for sales made while it was off.
    const feesStartAt =
      input.billingEnabled && !current.billingEnabled ? new Date() : current.feesStartAt;
    const data = {
      feeTiers: input.tiers,
      feeMonthlyCapUsd: input.monthlyCapUsd,
      feeMinInvoiceUsd: input.minInvoiceUsd,
      feeMonthlyInvoiceUsd: input.monthlyInvoiceUsd,
      feeInvoiceEveryMonths: input.invoiceEveryMonths,
      billingEnabled: input.billingEnabled,
      billingMerchantId: input.billingMerchantId,
      feesStartAt,
      updatedBy: admin.email,
    };
    await prisma.$transaction([
      prisma.platformSettings.upsert({
        where: { id: PLATFORM_SETTINGS_ID },
        create: { id: PLATFORM_SETTINGS_ID, ...data },
        update: data,
      }),
      auditLog(prisma, admin, admin.id, "updateBillingSettings", input),
    ]);
    // The landing and terms pages render per request from this cache.
    clearPlatformSettingsCache();
    return NextResponse.json(await getPlatformSettings({ fresh: true }));
  } catch (error) {
    console.error("[admin/billing/settings]", error);
    return NextResponse.json({ error: "Could not save the settings" }, { status: 500 });
  }
}
