import { prisma } from "@/lib/db";
import { otpCodeHtml } from "@/lib/emails/templates";
import { sendEmail } from "@/lib/mailer";
import { generateOtp, otpRecentlySent } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const resendSchema = z.object({
  email: z.string().email("Invalid email"),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;

    const parsed = resendSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const email = parsed.data.email.toLowerCase();

    if (await otpRecentlySent(email, "REGISTRATION")) {
      return NextResponse.json(
        { error: "Please wait 60 seconds before requesting another code" },
        { status: 429 },
      );
    }

    // No account, or one already verified, gets the same answer as a sent
    // code: "Account not found" let anyone test which addresses have accounts
    // (probed 2026-10-23).
    const merchant = await prisma.merchant.findUnique({
      where: { email },
    });
    if (!merchant || merchant.emailVerified) {
      return NextResponse.json({ success: true });
    }

    const otp = await generateOtp(email, "REGISTRATION");

    const sent = await sendEmail({
      to: email,
      subject: "Your Verification Code",
      html: otpCodeHtml({
        title: "Verify your account",
        intro: "Use this code to verify your Crypteo account. It is valid for 30 minutes.",
        code: otp,
        footer: "If you didn't request this code, you can safely ignore this email.",
      }),
    });
    if (!sent.success) throw new Error("verification code not delivered");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Resend OTP error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
