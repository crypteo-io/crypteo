import { checkEmail, emailRejectionMessage } from "@/lib/email-quality";
import { contactMessageHtml } from "@/lib/emails/templates";
import { SENDER, transporter } from "@/lib/mailer";
import { prisma } from "@/lib/db";
import { notifyAdmins } from "@/lib/notifications";
import { probeKind } from "@/lib/probe-patterns";
import { clientIp, rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { HOUR_MS } from "@/lib/time";
import { verifyTurnstile } from "@/lib/turnstile";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(254),
  subject: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().min(1, "Message is required").max(5000),
});

/** Contact messages per IP per hour: enough for a follow-up, not a fuzzer. */
const MESSAGES_PER_IP_PER_HOUR = 5;

const captchaSchema = z.object({ turnstileToken: z.string().min(1) });

// Contact fields are anonymous input in an HTML email read by admins;
// contactMessageHtml escapes every one of them.

// For header positions (display name, subject): no line breaks or quotes that
// could reshape the header, and a sane length.
function headerSafe(value: unknown, max = 120): string {
  return String(value ?? "")
    .replace(/[\r\n"<>]/g, " ")
    .trim()
    .slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;

    const body: unknown = await req.json().catch(() => null);

    const captcha = captchaSchema.safeParse(body);
    if (!captcha.success || !(await verifyTurnstile(captcha.data.turnstileToken))) {
      return NextResponse.json({ error: "Invalid captcha" }, { status: 400 });
    }

    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Name, email, and message are required" },
        { status: 400 },
      );
    }
    const form = parsed.data;

    const limited = await rateLimitScoped(req, "contact", MESSAGES_PER_IP_PER_HOUR, HOUR_MS);
    if (limited) return limited;
    // A reply has to reach someone: the same address check as sign-up.
    const rejection = emailRejectionMessage(await checkEmail(form.email));
    if (rejection) return NextResponse.json({ error: rejection, field: "email" }, { status: 400 });
    // Stored and shown escaped either way; the label tells admins it's a probe
    // (`{{7*7}}` as a name on 2026-10-29), not a customer.
    const probe = [form.name, form.subject, form.message].map((v) => (v ? probeKind(v) : null)).find(Boolean);

    // Stored first: the admin Contact page is the record, and a mail outage
    // must not lose the message (it used to exist only in the inbox).
    const saved = await prisma.contactMessage.create({
      data: { ...form, subject: form.subject || null, ip: clientIp(req) },
      select: { id: true },
    });
    await notifyAdmins({
      kind: "admin_contact",
      title: `${probe ? `Probe-like (${probe}) contact` : "Contact form"}: ${form.subject || form.name}`,
      body: `${form.name} (${form.email}): ${form.message.slice(0, 200)}`,
      link: `/contact?id=${saved.id}`,
    });

    try {
      // The sender is always ours: a visitor-chosen display name made any
      // message read as from "Your Bank" in an admin's inbox (pen-test
      // 2026-11-15), and spliced into SMTP_FROM's own display name it was
      // malformed.
      await transporter.sendMail({
        from: SENDER,
        replyTo: form.email,
        to: process.env.SMTP_FROM || "admin@crypteo.io",
        subject: `Contact form (${headerSafe(form.name, 60)}): ${headerSafe(form.subject) || "No Subject"}`,
        html: contactMessageHtml({ ...form, subject: form.subject || "" }),
      });
    } catch (mailError) {
      console.error("[contact] saved but not emailed:", mailError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
