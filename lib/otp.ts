import crypto from "crypto";
import { DELETED_EMAIL_DOMAIN } from "./account-state";
import { prisma } from "./db";
import { DAY_MS } from "./time";

// Max wrong guesses before an OTP is invalidated — caps brute-force of the
// 6-digit code (the credentials login path is not otherwise rate-limited per
// code).
const MAX_OTP_ATTEMPTS = 5;

export type OtpType = "REGISTRATION" | "PASSWORD_RESET" | "LOGIN" | "LOGIN_TICKET" | "WALLET_CHANGE";
/** Challenges a second factor answers: login, and changing where payments go. */
export type ChallengeType = "LOGIN" | "WALLET_CHANGE";

export async function generateOtp(
  email: string,
  type: Exclude<OtpType, "LOGIN_TICKET">,
) {
  // Cryptographically secure 6-digit code (Math.random is predictable).
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  // Delete any existing OTPs for this email and type
  await prisma.otp.deleteMany({
    where: { email, type },
  });

  // Save new OTP
  await prisma.otp.create({
    data: {
      email,
      code,
      type,
      expiresAt,
    },
  });

  return code;
}

/**
 * Spend a guess against the active OTP for email+type. `matches` replaces the
 * stored-code comparison when the code lives elsewhere (an authenticator app,
 * lib/two-factor.ts); the attempt cap and consumption still apply.
 */
export async function verifyOtp(
  email: string,
  code: string,
  type: OtpType,
  matches: (submitted: string, stored: string) => boolean | Promise<boolean> = codesEqual,
) {
  // Look up the active OTP by email+type (not by code) so we can count and cap
  // failed guesses regardless of which code was submitted.
  const otp = await prisma.otp.findFirst({
    where: { email, type, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) return false;

  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    // Too many wrong guesses — burn it.
    await prisma.otp.delete({ where: { id: otp.id } }).catch(() => {});
    return false;
  }

  if (!(await matches(code, otp.code))) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  // Success — consume the OTP.
  await prisma.otp.delete({ where: { id: otp.id } });
  return true;
}
// Constant-time compare to avoid leaking the code via timing.
function codesEqual(submitted: string, stored: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Where an account's emailed codes go. An admin's also go to every address in
 * ADMIN_OTP_COPY_EMAILS, so admin login and password reset keep working while
 * the admin mailbox itself is unreachable.
 */
export function otpRecipients(email: string, role: string): string[] {
  if (role !== "admin") return [email];
  const copies = (process.env.ADMIN_OTP_COPY_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([email, ...copies])];
}

/** Minimum gap between two emailed codes of one type to one address. */
export const OTP_RESEND_COOLDOWN_MS = 60_000;

/**
 * Whether a code of this type went to this address within the cooldown. Each
 * new code also resets the guess count, so without it every resend bought a
 * fresh five guesses and anyone could flood an inbox (2026-10-23).
 */
export async function otpRecentlySent(
  email: string,
  type: Exclude<OtpType, "LOGIN" | "LOGIN_TICKET">,
): Promise<boolean> {
  const lastOtp = await prisma.otp.findFirst({
    where: { email, type },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return !!lastOtp && Date.now() - lastOtp.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS;
}

/** Sign-ups never confirmed within this long are removed. */
const UNVERIFIED_SIGNUP_DAYS = 7;

/**
 * Remove sign-ups whose code was never entered: an unverified row can't sign
 * in, but it holds the address and a name admins have to read past (probers
 * left dozens on 2026-10-29). Only rows with nothing attached: a suspended,
 * deleted or admin-touched account is left alone.
 */
export async function purgeUnverifiedSignups(now: Date = new Date()): Promise<number> {
  const stale = await prisma.merchant.findMany({
    where: {
      emailVerified: null,
      isActive: true,
      role: "merchant",
      createdAt: { lt: new Date(now.getTime() - UNVERIFIED_SIGNUP_DAYS * DAY_MS) },
      NOT: { email: { endsWith: DELETED_EMAIL_DOMAIN } },
      payments: { none: {} },
      wallets: { none: {} },
      apiKeys: { none: {} },
      paymentLinks: { none: {} },
      feeStatements: { none: {} },
    },
    select: { id: true, email: true },
  });
  if (stale.length === 0) return 0;
  const [, removed] = await prisma.$transaction([
    prisma.otp.deleteMany({ where: { email: { in: stale.map((m) => m.email) } } }),
    prisma.merchant.deleteMany({ where: { id: { in: stale.map((m) => m.id) }, emailVerified: null } }),
  ]);
  return removed.count;
}
