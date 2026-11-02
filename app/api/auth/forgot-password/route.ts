import { prisma } from "@/lib/db";
import { otpCodeHtml } from "@/lib/emails/templates";
import { sendEmailToEach } from "@/lib/mailer";
import { generateOtp, otpRecentlySent, otpRecipients } from "@/lib/otp";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const forgotSchema = z.object({
  // Accounts are stored (and OTPs keyed) by lowercase email, as in login;
  // a mixed-case entry silently matched nothing.
  email: z.string().trim().toLowerCase().min(1, "Email required"),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;
    const scoped = await rateLimitScoped(req, "forgot-password", 5);
    if (scoped) return scoped;

    const parsed = forgotSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    const { email, turnstileToken } = parsed.data;

    const isHuman = !!turnstileToken && (await verifyTurnstile(turnstileToken));
    if (!isHuman) {
      return NextResponse.json({ error: "Invalid captcha" }, { status: 400 });
    }

    // Always the same answer whether or not the account exists or a code was
    // just sent (prevents email enumeration).
    const merchant = await prisma.merchant.findUnique({ where: { email } });
    if (!merchant || (await otpRecentlySent(email, "PASSWORD_RESET"))) {
      return NextResponse.json({ success: true });
    }

    const otp = await generateOtp(email, "PASSWORD_RESET");

    const delivered = await sendEmailToEach(otpRecipients(email, merchant.role), {
      subject: "Your Password Reset Code",
      html: otpCodeHtml({
        title: "Password Reset Request",
        intro:
          "Use the following code to reset your password. This code is valid for 30 minutes.",
        code: otp,
        footer:
          "If you didn't request a password reset, you can safely ignore this email.",
      }),
    });
    if (delivered === 0) {
      console.error("[forgot-password] reset code not delivered");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
