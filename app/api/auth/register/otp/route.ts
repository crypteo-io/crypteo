import { flagProbeInput } from "@/lib/abuse-signals";
import { merchantNameSchema } from "@/lib/account-schemas";
import { prisma } from "@/lib/db";
import { checkEmail, emailRejectionMessage } from "@/lib/email-quality";
import { otpCodeHtml } from "@/lib/emails/templates";
import { sendEmail } from "@/lib/mailer";
import { generateOtp, otpRecentlySent } from "@/lib/otp";
import { DAY_MS } from "@/lib/time";
import { rateLimit, rateLimitScoped } from "@/lib/rate-limit";
import { RESERVED_EMAIL_MESSAGE, isReservedEmail } from "@/lib/reserved-names";
import { verifyTurnstile } from "@/lib/turnstile";
import { passwordErrorMessage, passwordRegex } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * New accounts per IP per day. One IP range opened 14 accounts on 2026-10-29;
 * a business signs up once. Counted only when a new row would be created, so
 * resending a code or fixing a typo costs nothing.
 */
const SIGNUPS_PER_IP_PER_DAY = 3;

const otpSchema = z.object({
  name: merchantNameSchema.pipe(z.string().min(2, "Name too short")),
  email: z.string().email("Invalid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(passwordRegex, passwordErrorMessage),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;

    const parsed = otpSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const email = body.email.toLowerCase();
    const { name, password, turnstileToken } = body;

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

    // Signups are always merchants, and only admins hold platform addresses.
    if (isReservedEmail(email)) {
      console.warn(`[register] refused a platform-domain address: ${email}`);
      return NextResponse.json({ error: RESERVED_EMAIL_MESSAGE, field: "email" }, { status: 400 });
    }

    const rejection = emailRejectionMessage(await checkEmail(email));
    if (rejection) {
      return NextResponse.json({ error: rejection, field: "email" }, { status: 400 });
    }

    // Check if email already exists
    const existing = await prisma.merchant.findUnique({
      where: { email },
    });

    if (existing && existing.emailVerified) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 },
      );
    }

    if (await otpRecentlySent(email, "REGISTRATION")) {
      return NextResponse.json(
        { error: "Please wait 60 seconds before requesting another code" },
        { status: 429 },
      );
    }

    // Create or update unverified merchant
    const { hash } = await import("argon2");
    const hashedPassword = await hash(password);

    if (!existing) {
      const limited = await rateLimitScoped(req, "signup", SIGNUPS_PER_IP_PER_DAY, DAY_MS);
      if (limited) return limited;
    }

    let merchantId: string;
    if (existing) {
      console.log(`Updating unverified merchant: ${email}`);
      merchantId = existing.id;
      await prisma.merchant.update({
        where: { id: existing.id },
        data: {
          name,
          password: hashedPassword,
        },
      });
    } else {
      console.log(`Creating unverified merchant: ${email}`);
      const newMerchant = await prisma.merchant.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
      });
      console.log(`Merchant created with ID: ${newMerchant.id}`);
      merchantId = newMerchant.id;
    }
    await flagProbeInput(merchantId, "Sign-up", { name });

    // Generate and send OTP
    const otp = await generateOtp(email, "REGISTRATION");

    const sent = await sendEmail({
      to: email,
      subject: "Your Registration Code",
      html: otpCodeHtml({
        title: "Welcome to Crypteo",
        intro: "Use this code to complete your registration. It is valid for 30 minutes.",
        code: otp,
        footer: "If you didn't request this code, you can safely ignore this email.",
      }),
    });
    if (!sent.success) throw new Error("verification code not delivered");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("OTP generation error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate verification code. Please try again later.",
      },
      { status: 500 },
    );
  }
}
