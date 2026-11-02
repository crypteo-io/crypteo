import type { NextAuthOptions } from "next-auth";

/**
 * Skip the login OTP step. Only for local development without SMTP: requires
 * both a non-production NODE_ENV and an explicit ALLOW_DEV_LOGIN_BYPASS=true,
 * so a production deploy can never inherit it from a copied .env.
 */
export function isDevLoginBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_LOGIN_BYPASS === "true"
  );
}

/**
 * A sign-in form field, or undefined when it wasn't really sent. next-auth v4
 * posts signIn()'s options as form fields, where an undefined value arrives as
 * the string "undefined": the code step sent `ticket=undefined`, authorize
 * took it for a remembered-device ticket, failed to redeem it and refused
 * every code login as "LoginExpired" (2026-10-19).
 */
export function credentialField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "undefined" || trimmed === "null" ? undefined : trimmed;
}

let warnedCaptchaMissing = false;

/**
 * Whether login must present a valid Turnstile token: production, with a
 * secret configured. A production deploy without TURNSTILE_SECRET_KEY keeps
 * working (refusing every login would lock everyone out) but must not do so
 * silently — the captcha is the only brake on password guessing, so its
 * absence is logged loudly, once per process, the first time login asks.
 */
export function isCaptchaEnforced(): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.TURNSTILE_SECRET_KEY) return true;
  if (!warnedCaptchaMissing) {
    warnedCaptchaMissing = true;
    console.error(
      "[auth] SECURITY: TURNSTILE_SECRET_KEY is not set in production, so the login captcha is DISABLED and password guessing is limited only by rate limits. Set it and restart.",
    );
  }
  return false;
}

export const authConfig: NextAuthOptions = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  providers: [],
  callbacks: {
    async signIn({ user }) {
      if (user && !user.emailVerified) {
        return `/login?error=EmailNotVerified&email=${encodeURIComponent(user.email || "")}`;
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.name = user.name;
      }
      if (trigger === "update" && session?.name) {
        token.name = session.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.id;
        session.user.name = token.name;
      }
      return session;
    },
  },
};
