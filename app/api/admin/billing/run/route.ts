import { auditLog, requireAdmin } from "@/lib/admin";
import { runBillingCycle, runCycleClose } from "@/lib/billing/run";
import { prisma } from "@/lib/db";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * Run the worker's billing passes now: close last month (idempotent: nothing
 * already billed is billed again) and settle, hold and remind. For an admin
 * who just enabled billing or fixed a failed close.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;
  const scoped = await rateLimitScoped(req, "billing-run", 5);
  if (scoped) return scoped;

  try {
    const now = new Date();
    const close = await runCycleClose(now);
    const cycle = await runBillingCycle(now);
    await auditLog(prisma, admin, admin.id, "runBilling", {
      created: close.created,
      invoiced: close.invoiced,
    });
    return NextResponse.json({ close, cycle });
  } catch (error) {
    console.error("[admin/billing/run]", error);
    return NextResponse.json({ error: "The billing run failed" }, { status: 500 });
  }
}
