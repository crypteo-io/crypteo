import crypto from "crypto";
import { prisma } from "./db";
import { verifyOtp } from "./otp";
import { DAY_MS } from "./time";

/**
 * Trusted devices: a browser whose user ticked "Remember this device" when
 * entering a sign-up or login code signs in without one for
 * TRUSTED_DEVICE_DAYS, unless the login is suspicious (isTrustedLogin). The
 * browser holds a random id in DEVICE_COOKIE; only its hash is stored, with
 * the country Cloudflare reported when it was trusted.
 *
 * A trusted login still has two steps. Step one (captcha + password) issues a
 * single-use ticket bound to the device, and authorize() spends it in place of
 * a code, so authorize() never answers "right password" to a request that
 * didn't pass step one (see lib/auth.ts).
 */
export const DEVICE_COOKIE = "trusted_device";
const TRUSTED_DEVICE_DAYS = 30;
const TRUST_MS = TRUSTED_DEVICE_DAYS * DAY_MS;
const TICKET_MS = 2 * 60 * 1000;
const MAX_DEVICES_PER_MERCHANT = 10;
// Long-lived: the id only names the browser; trust itself expires server-side.
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Cloudflare's code for Tor exit nodes: never trusted.
const TOR_COUNTRY = "T1";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** The device id a request carries, or null when absent or malformed. */
export function readDeviceToken(value: string | null | undefined): string | null {
  return value && TOKEN_PATTERN.test(value) ? value : null;
}

/** The device id inside a raw Cookie header (authorize() sees no parsed cookies). */
export function deviceTokenFromCookieHeader(header: unknown): string | null {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEVICE_COOKIE) return readDeviceToken(rest.join("="));
  }
  return null;
}

/** The request's country from Cloudflare's CF-IPCountry, or null without one. */
export function requestCountry(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]{2}$/.test(value) ? value : null;
}

/** The request's device id, minting one when it has none. `minted` must be set as the cookie. */
export function ensureDeviceToken(value: string | null | undefined): {
  token: string;
  minted: boolean;
} {
  const existing = readDeviceToken(value);
  return existing ? { token: existing, minted: false } : { token: newToken(), minted: true };
}

export function deviceCookie(token: string) {
  return {
    name: DEVICE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_S,
  };
}

/**
 * Whether this login may skip the code. Suspicious, and so asked for a code:
 * a browser never trusted for this account, trust older than the window, trust
 * granted before the password changed or an admin signed the account out
 * everywhere, a country other than the one it was trusted from, or Tor.
 */
export async function isTrustedLogin(
  merchant: { id: string; passwordChangedAt: Date | null; sessionsRevokedAt: Date | null },
  token: string | null,
  country: string | null,
): Promise<boolean> {
  if (!token || country === TOR_COUNTRY) return false;
  const device = await prisma.trustedDevice.findUnique({
    where: { merchantId_tokenHash: { merchantId: merchant.id, tokenHash: sha256(token) } },
  });
  if (!device || device.expiresAt.getTime() <= Date.now()) return false;
  for (const revokedAt of [merchant.passwordChangedAt, merchant.sessionsRevokedAt]) {
    if (revokedAt && revokedAt.getTime() >= device.trustedAt.getTime()) return false;
  }
  return device.country === country;
}

/** Trust this browser for the account, after it proved a code. Keeps the newest few. */
export async function trustDevice(
  merchantId: string,
  token: string,
  country: string | null,
): Promise<void> {
  if (country === TOR_COUNTRY) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRUST_MS);
  const tokenHash = sha256(token);
  await prisma.trustedDevice.upsert({
    where: { merchantId_tokenHash: { merchantId, tokenHash } },
    create: { merchantId, tokenHash, country, trustedAt: now, expiresAt },
    update: { country, trustedAt: now, expiresAt },
  });
  const stale = await prisma.trustedDevice.findMany({
    where: { merchantId },
    orderBy: { trustedAt: "desc" },
    skip: MAX_DEVICES_PER_MERCHANT,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.trustedDevice.deleteMany({ where: { id: { in: stale.map((d) => d.id) } } });
  }
}

function ticketHash(ticket: string, deviceToken: string): string {
  return sha256(`${ticket}:${sha256(deviceToken)}`);
}

/** Step one's proof for a trusted login: single use, short-lived, bound to the device. */
export async function issueLoginTicket(email: string, deviceToken: string): Promise<string> {
  const ticket = newToken();
  await prisma.otp.deleteMany({ where: { email, type: "LOGIN_TICKET" } });
  await prisma.otp.create({
    data: {
      email,
      type: "LOGIN_TICKET",
      code: ticketHash(ticket, deviceToken),
      expiresAt: new Date(Date.now() + TICKET_MS),
    },
  });
  return ticket;
}

/** Spend a login ticket. Fails without the device cookie it was issued to. */
export async function redeemLoginTicket(
  email: string,
  ticket: string,
  deviceToken: string | null,
): Promise<boolean> {
  if (!deviceToken || !TOKEN_PATTERN.test(ticket)) return false;
  return verifyOtp(email, ticket, "LOGIN_TICKET", (submitted, stored) =>
    hashesEqual(ticketHash(submitted, deviceToken), stored),
  );
}
