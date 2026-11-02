import { signInHostRefusal } from "@/lib/admin-host";
import { isCaptchaEnforced, isDevLoginBypassEnabled } from "@/lib/auth.config";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import {
  DEVICE_COOKIE,
  deviceCookie,
  ensureDeviceToken,
  isTrustedLogin,
  issueLoginTicket,
  requestCountry,
} from "@/lib/trusted-device";
import { verifyTurnstile } from "@/lib/turnstile";
import { issueChallenge } from "@/lib/two-factor";
import { verify } from "argon2";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req);
    if (rl) return rl;

    const { email: rawEmail, password, turnstileToken } = (await req.json().catch(() => null)) ?? {};
    const email = typeof rawEmail === "string" ? rawEmail.toLowerCase() : "";

    if (!email || typeof password !== "string" || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    // This is the step that checks the password, so this is where the captcha
    // has to be — behind only the per-IP rate limit it was an unthrottled-
    // enough password-guessing endpoint that the login form's captcha never
    // protected. Checked before any account lookup.
    if (isCaptchaEnforced()) {
      if (
        typeof turnstileToken !== "string" ||
        !turnstileToken ||
        !(await verifyTurnstile(turnstileToken))
      ) {
        return NextResponse.json({ error: "Invalid captcha" }, { status: 400 });
      }
    }

    const merchant = await prisma.merchant.findUnique({ where: { email } });
    if (!merchant) {
      // Generic error to avoid account enumeration
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const isValid = await verify(merchant.password, password);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    // Deactivated (incl. self-deleted) accounts get the same answer as a wrong
    // password, and must not be able to trigger OTP emails.
    if (!merchant.isActive) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    // Admins sign in on the admin host only, merchants on the site only.
    // Asked only after the password, so it tells a guesser nothing.
    const hostRefusal = signInHostRefusal(merchant.role, req.headers.get("host"));
    if (hostRefusal) {
      return NextResponse.json({ error: hostRefusal }, { status: 403 });
    }

    // Check if account is verified at all (registration verification)
    if (!merchant.emailVerified) {
      return NextResponse.json(
        { error: "EmailNotVerified", email: merchant.email },
        { status: 403 },
      );
    }

    // Local-dev-only OTP skip (see isDevLoginBypassEnabled); must agree with
    // authorize() in lib/auth.ts or the client would never be asked for a code.
    if (isDevLoginBypassEnabled()) {
      return NextResponse.json({ otpRequired: false });
    }

    // A trusted browser skips the code unless the login is suspicious
    // (lib/trusted-device.ts). Step two spends the ticket instead, so it still
    // only proceeds after this step passed. A browser with no device id gets
    // one now, to be trusted once its code is proven.
    const device = ensureDeviceToken(req.cookies.get(DEVICE_COOKIE)?.value);
    const respond = (body: Record<string, unknown>) => {
      const res = NextResponse.json(body);
      if (device.minted) res.cookies.set(deviceCookie(device.token));
      return res;
    };
    const country = requestCountry(req.headers.get("cf-ipcountry"));
    if (!device.minted && (await isTrustedLogin(merchant, device.token, country))) {
      return respond({ otpRequired: false, ticket: await issueLoginTicket(email, device.token) });
    }

    return respond({ otpRequired: true, method: await issueChallenge(merchant, "LOGIN") });
  } catch (error) {
    console.error("Login OTP error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
