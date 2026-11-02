import crypto from "crypto";
import { prisma } from "./db";
import { otpCodeHtml } from "./emails/templates";
import { sendEmailToEach } from "./mailer";
import { generateOtp, otpRecipients, verifyOtp, type ChallengeType } from "./otp";

export const TWO_FACTOR_METHODS = ["email", "totp"] as const;
export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number];

const TOTP_ISSUER = "Crypteo";
const TOTP_STEP_S = 30;
const TOTP_DIGITS = 6;
// Steps either side of now that still verify: absorbs ±30s of phone clock drift.
const TOTP_DRIFT_STEPS = 1;
const TOTP_SECRET_BYTES = 20;
const MIN_ENCRYPTION_KEY_LENGTH = 32;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SECRET_FORMAT = "v1";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

/** RFC 6238 code (HMAC-SHA1, 6 digits) for one 30-second step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto
    .createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

export function totpStepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_S);
}

/**
 * The step a submitted code belongs to, or null. Steps at or before
 * lastUsedStep never match, so a code that already signed someone in (or an
 * earlier one, observed over a shoulder) is dead.
 */
export function findTotpStep(
  secret: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStepAt(nowMs);
  const submitted = Buffer.from(code);
  for (let step = now - TOTP_DRIFT_STEPS; step <= now + TOTP_DRIFT_STEPS; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (crypto.timingSafeEqual(submitted, Buffer.from(totpCode(secret, step)))) {
      return step;
    }
  }
  return null;
}

export function totpUri(email: string, secret: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_S),
  });
  return `otpauth://totp/${label}?${params}`;
}

// ── Secret storage ──

function encryptionKey(): Buffer | null {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN_ENCRYPTION_KEY_LENGTH) return null;
  return Buffer.from(
    crypto.hkdfSync("sha256", raw, Buffer.alloc(0), "crypteo-totp", 32),
  );
}

/** Whether authenticator enrolment can be offered (the encryption key is set). */
export function isAuthenticatorAvailable(): boolean {
  return encryptionKey() !== null;
}

export function encryptSecret(secret: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("TWO_FACTOR_ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    SECRET_FORMAT,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    data.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("TWO_FACTOR_ENCRYPTION_KEY is not configured");
  const [format, iv, tag, data] = stored.split(":");
  if (format !== SECRET_FORMAT || !iv || !tag || !data) {
    throw new Error("Unrecognised TOTP secret format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ── Verification ──

/**
 * Claim a step for this merchant, atomically. Two concurrent sign-ins with the
 * same code race on this update and only one wins.
 */
async function claimTotpStep(merchantId: string, step: number): Promise<boolean> {
  const { count } = await prisma.merchant.updateMany({
    where: {
      id: merchantId,
      OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
    },
    data: { totpLastUsedStep: step },
  });
  return count === 1;
}

/**
 * Verify a TOTP code against a merchant's active secret and consume its step.
 * Used where the session is already authenticated (switching back to email).
 */
export async function verifyTotpForMerchant(
  merchantId: string,
  code: string,
): Promise<boolean> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { totpSecret: true, totpLastUsedStep: true },
  });
  if (!merchant?.totpSecret) return false;
  const step = findTotpStep(
    decryptSecret(merchant.totpSecret),
    code,
    Date.now(),
    merchant.totpLastUsedStep,
  );
  return step !== null && claimTotpStep(merchantId, step);
}

/**
 * Answers a challenge issueChallenge created: step two of login, or a wallet
 * change. Both methods spend the challenge row, so a code is only checked
 * after the step that issued it, and wrong guesses burn it after
 * MAX_OTP_ATTEMPTS whichever method the account uses. For an email account the
 * row holds the mailed code; for an authenticator account its code is never
 * sent and the TOTP is checked instead.
 */
export async function verifyChallenge(email: string, code: string, type: ChallengeType): Promise<boolean> {
  const merchant = await prisma.merchant.findUnique({
    where: { email },
    select: {
      id: true,
      twoFactorMethod: true,
      totpSecret: true,
      totpLastUsedStep: true,
    },
  });
  if (merchant?.twoFactorMethod !== "totp" || !merchant.totpSecret) {
    return verifyOtp(email, code, type);
  }

  const secret = decryptSecret(merchant.totpSecret);
  return verifyOtp(email, code, type, async (submitted) => {
    const step = findTotpStep(secret, submitted, Date.now(), merchant.totpLastUsedStep);
    return step !== null && claimTotpStep(merchant.id, step);
  });
}

/** The method step one should ask for: authenticator only when fully enrolled. */
export function effectiveTwoFactorMethod(merchant: {
  twoFactorMethod: string;
  totpSecret: string | null;
}): TwoFactorMethod {
  return merchant.twoFactorMethod === "totp" && merchant.totpSecret ? "totp" : "email";
}

const CHALLENGE_MAIL: Record<ChallengeType, { subject: string; title: string; intro: string; footer: string }> = {
  LOGIN: {
    subject: "Your Login Verification Code",
    title: "Login Verification",
    intro: "Use the following code to complete your login. This code is valid for 30 minutes.",
    footer: "If you didn't request this code, please change your password immediately.",
  },
  WALLET_CHANGE: {
    subject: "Confirm your receiving wallet change",
    title: "Confirm a wallet change",
    intro: "Someone signed in to your account is changing where your payments are sent. Enter this code to confirm it. It is valid for 30 minutes.",
    footer: "If this wasn't you, don't share the code: change your password and sign out everywhere from Settings.",
  },
};

/**
 * Creates a challenge row for the account and mails its code, or for an
 * authenticator account leaves the code unsent; returns the method to ask for.
 */
export async function issueChallenge(
  merchant: { email: string; role: string; twoFactorMethod: string; totpSecret: string | null },
  type: ChallengeType,
): Promise<TwoFactorMethod> {
  const method = effectiveTwoFactorMethod(merchant);
  const code = await generateOtp(merchant.email, type);
  if (method === "totp") return method;
  const { subject, ...copy } = CHALLENGE_MAIL[type];
  const recipients = otpRecipients(merchant.email, merchant.role);
  const delivered = await sendEmailToEach(recipients, { subject, html: otpCodeHtml({ ...copy, code }) });
  if (delivered === 0) console.error(`[${type}] code not delivered to any of ${recipients.length} recipient(s)`);
  return method;
}
