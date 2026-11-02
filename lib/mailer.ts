import { accountDashboardUrl } from "./admin-host";
import nodemailer from "nodemailer";
import { accountSecurityChangeHtml, adminMessageHtml } from "./emails/templates";

const DEFAULT_SMTP_PORT = 587;
const IMPLICIT_TLS_PORT = 465;

/**
 * Transport options from SMTP_HOST/SMTP_PORT. 465 is implicit TLS (Cloudflare
 * Email Service accepts only that); any other port must upgrade with
 * STARTTLS, never send credentials in the clear. The port used to be fixed at
 * 587, so a provider on 465 could never connect.
 */
type SmtpEnv = Partial<Record<"SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS", string | undefined>> &
  Record<string, string | undefined>;

export function smtpOptions(env: SmtpEnv = process.env) {
  const parsed = Number(env.SMTP_PORT);
  const port = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SMTP_PORT;
  const implicitTls = port === IMPLICIT_TLS_PORT;
  return {
    host: env.SMTP_HOST,
    port,
    secure: implicitTls,
    requireTLS: !implicitTls,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  };
}

export const transporter = nodemailer.createTransport(smtpOptions());

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}): Promise<{ success: boolean; error?: unknown }> {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || '"Crypteo" <noreply@crypteo.io>',
      to,
      subject,
      text,
      html,
      headers: { "X-Priority": "1", "X-MSMail-Priority": "High", Importance: "High" },
    });
    return { success: true };
  } catch (error) {
    console.error("[mailer] Failed to send email:", error);
    return { success: false, error };
  }
}

/**
 * Send one message to each address separately, so one dead mailbox (or one
 * rejected recipient) never blocks the others and no recipient sees the rest.
 * Resolves to the number accepted.
 */
export async function sendEmailToEach(
  recipients: string[],
  mail: { subject: string; html: string },
): Promise<number> {
  const results = await Promise.all(
    recipients.map((to) => sendEmail({ to, ...mail })),
  );
  return results.filter((r) => r.success).length;
}

/** "0x1234…abcd": enough to recognise an address, not enough to copy it. */
export function maskAddress(address: string): string {
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Tell a merchant that a receiving address or API key changed on their
 * account. A stolen session can redirect funds or mint keys without any other
 * trace, so the owner hears about it. Never throws and callers don't await it:
 * a mail outage must not block or fail the change itself.
 */
export async function notifyAccountSecurityChange(opts: {
  to: string;
  merchantName: string;
  action: string;
  details: { label: string; value: string }[];
  ip: string;
  /** Dashboard page to review the change, e.g. "/dashboard/wallets". */
  reviewPath: string;
  /** The account's role: an admin reviews on the admin host. */
  role: string;
}): Promise<void> {
  try {
    const result = await sendEmail({
      to: opts.to,
      subject: `Security alert: ${opts.action} on your Crypteo account`,
      html: accountSecurityChangeHtml({
        merchantName: opts.merchantName,
        action: opts.action,
        details: opts.details,
        time: new Date().toISOString(),
        ip: opts.ip,
        dashboardUrl: accountDashboardUrl(opts.role, opts.reviewPath),
      }),
    });
    if (!result.success) {
      console.error(`[mailer] security notice "${opts.action}" not delivered`);
    }
  } catch (err) {
    console.error("[mailer] security notice failed:", err);
  }
}

/** A message an admin wrote to one merchant. True when the mail was accepted. */
export async function sendAdminMessage(opts: {
  to: string;
  merchantName: string;
  subject: string;
  message: string;
}): Promise<boolean> {
  const base = process.env.NEXTAUTH_URL || "https://crypteo.io";
  const result = await sendEmail({
    to: opts.to,
    subject: opts.subject,
    text: opts.message,
    html: adminMessageHtml({
      merchantName: opts.merchantName,
      subject: opts.subject,
      message: opts.message,
      dashboardUrl: `${base}/dashboard`,
    }),
  });
  return result.success;
}
