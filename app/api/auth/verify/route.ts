import { prisma } from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";
import {
  DEVICE_COOKIE,
  deviceCookie,
  ensureDeviceToken,
  requestCountry,
  trustDevice,
} from "@/lib/trusted-device";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const verifySchema = z.object({
  email: z.string().email("Invalid email"),
  otp: z.string().length(6, "Code must be 6 digits"),
  trustDevice: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;

    const parsed = verifySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const email = body.email.toLowerCase();
    const { otp } = body;

    // Verify OTP
    const isOtpValid = await verifyOtp(email, otp, "REGISTRATION");
    if (!isOtpValid) {
      return NextResponse.json(
        { error: "Invalid or expired verification code" },
        { status: 400 },
      );
    }

    // Mark as verified
    const merchant = await prisma.merchant.update({
      where: { email },
      data: {
        emailVerified: new Date(),
      },
    });

    // Asked to remember this browser, proving the sign-up code trusts it like
    // a login code does: its logins skip the code unless suspicious.
    const device = ensureDeviceToken(req.cookies.get(DEVICE_COOKIE)?.value);
    if (body.trustDevice) {
      await trustDevice(merchant.id, device.token, requestCountry(req.headers.get("cf-ipcountry")));
    }

    const res = NextResponse.json({
      success: true,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        emailVerified: merchant.emailVerified,
      },
    });
    if (device.minted) res.cookies.set(deviceCookie(device.token));
    return res;
  } catch (error) {
    console.error("Verification error:", error);
    return NextResponse.json(
      { error: "Verification failed. Please try again later." },
      { status: 500 },
    );
  }
}
