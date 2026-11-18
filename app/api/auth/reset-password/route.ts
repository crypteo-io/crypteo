import { signInHostRefusal } from "@/lib/admin-host";
import { prisma } from "@/lib/db";
import { notifyAccountSecurityChange } from "@/lib/mailer";
import { verifyOtp } from "@/lib/otp";
import { clientIp, rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { passwordErrorMessage, passwordRegex } from "@/lib/validation";
import { hash } from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const resetSchema = z.object({
  // Lowercased like login and forgot-password, so the OTP (keyed by the
  // lowercase address) is found.
  email: z.string().trim().toLowerCase().email(),
  otp: z.string().length(6),
  password: z.string().min(8).regex(passwordRegex, passwordErrorMessage),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;
    const scoped = await rateLimitScoped(req, "reset-password", 10);
    if (scoped) return scoped;

    const parsed = resetSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const { email, otp, password, turnstileToken } = parsed.data;

    // Verify Turnstile
    if (
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    ) {
      if (!turnstileToken) {
        return NextResponse.json(
          { error: "Captcha is required" },
          { status: 400 },
        );
      }
      const isVerified = await verifyTurnstile(turnstileToken);
      if (!isVerified) {
        return NextResponse.json(
          { error: "Captcha verification failed" },
          { status: 400 },
        );
      }
    }

    // The same answer for no account, the wrong host (forgot-password never
    // sends an admin's code from the site) and a wrong code.
    const merchant = await prisma.merchant.findUnique({ where: { email } });
    if (
      !merchant ||
      signInHostRefusal(merchant.role, req.headers.get("host")) ||
      !(await verifyOtp(email, otp, "PASSWORD_RESET"))
    ) {
      return NextResponse.json(
        { error: "Invalid or expired reset code" },
        { status: 400 },
      );
    }

    const hashedPassword = await hash(password);

    await prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        password: hashedPassword,
        // Revokes every session opened before the reset (lib/auth.ts).
        passwordChangedAt: new Date(),
      },
    });

    void notifyAccountSecurityChange({
      to: merchant.email,
      merchantName: merchant.name,
      action: "Password reset",
      details: [{ label: "Account", value: merchant.email }],
      ip: clientIp(req),
      reviewPath: "/dashboard/settings",
      role: merchant.role,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
