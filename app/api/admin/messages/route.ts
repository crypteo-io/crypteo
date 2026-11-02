import { isDeletedAccountEmail } from "@/lib/account-state";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { sendAdminMessage } from "@/lib/mailer";
import { BODY_MAX, MAX_EMAIL_RECIPIENTS, TITLE_MAX } from "@/lib/notification-limits";
import { notifyMerchants } from "@/lib/notifications";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const MAX_BROADCAST_RECIPIENTS = 10_000;
const ID = /^[a-z0-9]{20,40}$/;

const schema = z
  .object({
    merchantIds: z.array(z.string().regex(ID)).min(1).max(MAX_EMAIL_RECIPIENTS).optional(),
    audience: z.enum(["all_merchants"]).optional(),
    subject: z.string().trim().min(1, "Add a subject").max(TITLE_MAX),
    message: z.string().trim().min(1, "Write a message").max(BODY_MAX),
    email: z.boolean(),
    inApp: z.boolean(),
  })
  .refine((d) => !!d.merchantIds !== !!d.audience, {
    message: "Choose recipients or an audience",
    path: ["merchantIds"],
  })
  .refine((d) => d.email || d.inApp, {
    message: "Send it by email, in the dashboard, or both",
    path: ["email"],
  });

/**
 * A message from an admin to one merchant, a few, or every active merchant:
 * by email (SMTP, branded), in the dashboard bell, or both. Each recipient
 * gets an audit row.
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;
  const scoped = await rateLimitScoped(req, "admin-message", 20);
  if (scoped) return scoped;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid request", field: issue?.path[0] },
      { status: 400 },
    );
  }
  const { merchantIds, audience, subject, message, email, inApp } = parsed.data;

  try {
    const recipients = (
      await prisma.merchant.findMany({
        where: audience
          ? { role: "merchant", isActive: true }
          : { id: { in: merchantIds } },
        select: { id: true, name: true, email: true },
        take: MAX_BROADCAST_RECIPIENTS,
      })
    ).filter((m) => !isDeletedAccountEmail(m.email));
    if (recipients.length === 0) {
      return NextResponse.json({ error: "No one to send to" }, { status: 400 });
    }
    if (email && recipients.length > MAX_EMAIL_RECIPIENTS) {
      return NextResponse.json(
        {
          error: `Email goes to at most ${MAX_EMAIL_RECIPIENTS} accounts at once; send this to all ${recipients.length} in the dashboard only.`,
          field: "email",
        },
        { status: 400 },
      );
    }

    const notified = inApp
      ? await notifyMerchants(
          recipients.map((r) => r.id),
          { kind: "admin_message", title: subject, body: message },
        )
      : 0;
    let emailed = 0;
    if (email) {
      for (const r of recipients) {
        if (await sendAdminMessage({ to: r.email, merchantName: r.name, subject, message })) emailed++;
      }
    }

    await prisma.adminAuditLog.createMany({
      data: recipients.map((r) => ({
        adminId: admin.id,
        adminEmail: admin.email,
        merchantId: r.id,
        action: "sendMessage",
        details: { subject, email, inApp, audience: audience ?? "direct" },
      })),
    });

    if (email && emailed === 0) {
      return NextResponse.json(
        { error: "The email could not be sent. Check the mail server.", notified },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, recipients: recipients.length, emailed, notified });
  } catch (error) {
    console.error("[admin/messages]", error);
    return NextResponse.json({ error: "Could not send the message" }, { status: 500 });
  }
}
