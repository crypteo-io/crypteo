import { auditLog, requireAdmin } from "@/lib/admin";
import { BILLING_PATH, notifyHoldLifted, notifyStatementPaid } from "@/lib/billing/notices";
import { liftBillingHolds } from "@/lib/billing/statements";
import { prisma } from "@/lib/db";
import { notifyMerchant } from "@/lib/notifications";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DAY_MS } from "@/lib/time";

const note = z.string().trim().min(3, "Add a short note for the record").max(500);

const schema = z.discriminatedUnion("action", [
  // Paid outside the checkout (a direct transfer the admin verified).
  z.object({ action: z.literal("markPaid"), note }),
  z.object({ action: z.literal("waive"), note }),
  // More time: moves the due date and re-arms the reminders still ahead.
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(60), note }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid request", field: issue?.path[0] },
      { status: 400 },
    );
  }
  const action = parsed.data;

  try {
    const statement = await prisma.feeStatement.findUnique({
      where: { id },
      select: { id: true, merchantId: true, status: true, dueAt: true },
    });
    if (!statement) return NextResponse.json({ error: "Statement not found" }, { status: 404 });

    const now = new Date();
    let data;
    let allowed: string[];
    switch (action.action) {
      case "markPaid":
        allowed = ["open", "carried"];
        data = { status: "paid", paidAt: now, resolvedBy: admin.email, note: action.note };
        break;
      case "waive":
        allowed = ["open", "carried"];
        data = { status: "waived", resolvedBy: admin.email, note: action.note };
        break;
      case "extend": {
        allowed = ["open"];
        const from = Math.max(now.getTime(), statement.dueAt?.getTime() ?? now.getTime());
        const dueAt = new Date(from + action.days * DAY_MS);
        const hoursLeft = (dueAt.getTime() - now.getTime()) / (60 * 60 * 1000);
        data = {
          dueAt,
          noticeHoldAt: null,
          ...(hoursLeft > 24 ? { notice24hAt: null } : {}),
          ...(hoursLeft > 72 ? { notice72hAt: null } : {}),
          resolvedBy: admin.email,
          note: action.note,
        };
        break;
      }
    }
    // Compare-and-set: a checkout that settled it a moment ago wins.
    const { count } = await prisma.feeStatement.updateMany({
      where: { id, status: { in: allowed } },
      data,
    });
    if (!count) {
      return NextResponse.json({ error: "This statement changed; reload and try again" }, { status: 409 });
    }
    await auditLog(prisma, admin, statement.merchantId, `statement:${action.action}`, {
      statementId: id,
      note: action.note,
      ...(action.action === "extend" ? { days: action.days } : {}),
    });

    if (action.action === "markPaid") await notifyStatementPaid(id, "admin");
    if (action.action === "waive") {
      await notifyMerchant(statement.merchantId, {
        kind: "fee_paid",
        title: "Fee invoice waived",
        body: "An invoice on your account was waived. Nothing is owed for it.",
        link: BILLING_PATH,
      });
    }
    if (action.action === "extend") {
      await notifyMerchant(statement.merchantId, {
        kind: "fee_reminder",
        title: "More time to pay your fees",
        body: `Your invoice's due date moved by ${action.days} day${action.days === 1 ? "" : "s"}.`,
        link: BILLING_PATH,
      });
    }
    for (const merchantId of await liftBillingHolds(now, [statement.merchantId])) {
      await notifyHoldLifted(merchantId);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/billing/statements/:id]", error);
    return NextResponse.json({ error: "Could not update the statement" }, { status: 500 });
  }
}
