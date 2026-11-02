import { verify } from "argon2";
import NextAuth, { getServerSession, NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { signInHostRefusal } from "./admin-host";
import { authConfig, credentialField, isDevLoginBypassEnabled } from "./auth.config";
import { prisma } from "./db";
import {
  deviceTokenFromCookieHeader,
  redeemLoginTicket,
  requestCountry,
  trustDevice,
} from "./trusted-device";

// How often a live JWT is re-checked against the merchant row. JWTs are
// stateless, so without this a deactivated merchant, a demoted admin, or a
// session opened before a password change stays valid for the full 24h maxAge.
// One indexed lookup per session per window keeps the cost negligible.
const SESSION_RECHECK_MS = 5 * 60 * 1000;

// Our additions to the token: when the credentials were proven (epoch ms), and
// when the merchant row was last re-checked. Both optional so tokens issued
// before this change still decode (and get checked immediately).
type SessionToken = JWT & { authTime?: number; checkedAt?: number };

/**
 * Throws if the token no longer matches the merchant it was issued for. In
 * next-auth v4 a throw from the jwt callback clears the session cookie and
 * makes getServerSession() return null, which every route treats as signed out.
 */
async function revalidateToken(token: SessionToken): Promise<SessionToken> {
  const now = Date.now();
  if (token.checkedAt && now - token.checkedAt < SESSION_RECHECK_MS) {
    return token;
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: token.id },
    select: {
      role: true,
      isActive: true,
      passwordChangedAt: true,
      sessionsRevokedAt: true,
    },
  });
  if (!merchant || !merchant.isActive) throw new Error("SessionRevoked");
  if (merchant.role !== token.role) throw new Error("SessionRevoked");
  // Tokens minted before authTime existed are treated as issued at epoch, so a
  // password change still revokes them.
  const authTime = token.authTime ?? 0;
  for (const revokedAt of [merchant.passwordChangedAt, merchant.sessionsRevokedAt]) {
    if (revokedAt && revokedAt.getTime() > authTime) {
      throw new Error("SessionRevoked");
    }
  }

  return { ...token, checkedAt: now };
}

export const authOptions: NextAuthOptions = {
  ...authConfig,
  session: {
    ...authConfig.session,
    strategy: "jwt",
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = await authConfig.callbacks!.jwt!(params);
      if (params.user) {
        // Fresh sign-in: this is the moment the credentials were proven.
        const now = Date.now();
        return { ...token, authTime: now, checkedAt: now };
      }
      return revalidateToken(token);
    },
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otp: { label: "OTP", type: "text" },
        ticket: { label: "Trusted device ticket", type: "text" },
        trustDevice: { label: "Remember this device", type: "text" },
        turnstileToken: { label: "Turnstile Token", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = (credentials.email as string).toLowerCase();
        const password = credentials.password as string;
        const otp = credentialField(credentials.otp);
        const ticket = credentialField(credentials.ticket);
        const deviceToken = deviceTokenFromCookieHeader(req.headers?.cookie);
        let codeProven = false;

        // Every real sign-in is two steps: /api/auth/login/otp checks the
        // password behind the captcha and emails a code, then this step
        // presents the code. The code is proven BEFORE the password is looked
        // at, so this endpoint never answers "right password" to anyone who
        // hasn't passed step one — which is what lets it skip a captcha of its
        // own. It has to: Turnstile tokens are single-use, and the client's
        // token was spent on step one. (Checking the password first, as this
        // used to, made "OTPRequired" vs. null a captcha-free password oracle
        // once the captcha moved to step one.)
        //
        // A trusted browser presents step one's ticket instead of a code
        // (lib/trusted-device.ts): the same proof that step one passed, bound
        // to this browser's device cookie.
        //
        // The only other skip is an explicit local-dev opt-in; there is no
        // per-account exemption (seed accounts used to have one, in every
        // environment including production). It can't coexist with the
        // captcha: isCaptchaEnforced() is production-only, the bypass never is.
        if (!isDevLoginBypassEnabled()) {
          if (ticket) {
            if (!(await redeemLoginTicket(email, ticket, deviceToken))) {
              throw new Error("LoginExpired");
            }
          } else {
            if (!otp) {
              throw new Error("OTPRequired");
            }

            // Email code or authenticator, per the account (lib/two-factor.ts).
            const { verifyChallenge } = await import("./two-factor");
            const isOtpValid = await verifyChallenge(email, otp, "LOGIN");
            if (!isOtpValid) {
              throw new Error("InvalidOTP");
            }
            codeProven = true;
          }
        }

        const merchant = await prisma.merchant.findUnique({ where: { email } });
        if (!merchant) {
          return null;
        }

        const isValid = await verify(merchant.password, password);
        if (!isValid) {
          return null;
        }

        // Checked after the password so a deactivated account is
        // indistinguishable from a wrong password (no enumeration).
        if (!merchant.isActive) {
          return null;
        }
        // Step one refuses the wrong host with a message; this is the backstop.
        const host = req.headers?.host;
        if (signInHostRefusal(merchant.role, typeof host === "string" ? host : null)) {
          return null;
        }

        // Only on request ("Remember this device") and only after a code.
        if (codeProven && deviceToken && credentials.trustDevice === "true") {
          await trustDevice(merchant.id, deviceToken, requestCountry(req.headers?.["cf-ipcountry"]));
        }

        return {
          id: merchant.id,
          email: merchant.email,
          name: merchant.name,
          role: merchant.role,
          emailVerified: merchant.emailVerified,
        };
      },
    }),
  ],
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

/**
 * Compatibility helper to maintain v5 syntax in server components/actions:
 * const session = await auth();
 */
export async function auth() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return session;
  // The JWT is only re-checked every SESSION_RECHECK_MS, which let a
  // suspended or deleted merchant keep using the dashboard and API (wallets,
  // keys, webhook endpoints) for up to five minutes. Account status is
  // checked on every request; one primary-key read.
  if (!(await isAccountActive(session.user.id))) return null;
  return session;
}

/** Whether the merchant may still use the dashboard: not suspended or deleted. */
export async function isAccountActive(merchantId: string): Promise<boolean> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { isActive: true },
  });
  return !!merchant?.isActive;
}
