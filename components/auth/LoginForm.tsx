"use client";

import { CodeInput } from "@/components/ui/CodeInput";
import {
  AUTH_LABEL,
  AUTH_LINK,
  AuthAlert,
  AuthCard,
  AuthSpinner,
  RememberDevice,
} from "@/components/auth/AuthCard";
import { Button } from "@/components/site/Button";
import TurnstileWidget from "@/components/TurnstileWidget";
import { toast } from "@/lib/toast";
import { ArrowRight, KeyRound, MailCheck } from "lucide-react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SecretInput } from "@/components/ui/SecretInput";

/** Same-site paths only: a callbackUrl to another origin is an open redirect. */
function safeCallback(value: string | null, fallback: string): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

/** `admin`: the admin host's sign-in, which has no sign-up. */
export function LoginForm({ admin }: { admin: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtp, setShowOtp] = useState(false);
  const [otpMethod, setOtpMethod] = useState<"email" | "totp">("email");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Turnstile tokens are single-use and step 1 spends it, so every step-1
  // attempt remounts the widget (new key) to get a fresh one for a retry.
  const [captchaKey, setCaptchaKey] = useState(0);
  const resetCaptcha = () => {
    setTurnstileToken(null);
    setCaptchaKey((k) => k + 1);
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeCallback(searchParams.get("callbackUrl"), admin ? "/" : "/dashboard");

  // Redirects from signup and verification land here with a flag.
  const arrivedVerified =
    searchParams.get("verified") === "true" || searchParams.get("registered") === "true";
  const welcomed = useRef(false);
  useEffect(() => {
    if (!arrivedVerified || welcomed.current) return;
    welcomed.current = true;
    toast.success("Email verified", "Sign in to open your dashboard.");
  }, [arrivedVerified]);

  // From /api/auth/session-ended: the account can no longer be used.
  const signedOut = searchParams.get("signedOut") === "1";
  const toldSignedOut = useRef(false);
  useEffect(() => {
    if (!signedOut || toldSignedOut.current) return;
    toldSignedOut.current = true;
    toast.info("You've been signed out", "If you can't sign in again, contact support.");
  }, [signedOut]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // The captcha guards step 1 (the password check); step 2 is the emailed code.
    if (
      !showOtp &&
      !turnstileToken &&
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    ) {
      setError("Please complete the captcha");
      setLoading(false);
      return;
    }

    try {
      // A remembered browser gets a ticket from step 1 instead of a code prompt.
      let ticket: string | undefined;
      if (!showOtp) {
        // Step 1: Request OTP or Check Bypass
        const otpRes = await fetch("/api/auth/login/otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, turnstileToken }),
        });
        resetCaptcha();

        const otpData = await otpRes.json().catch(() => ({}));

        if (!otpRes.ok) {
          if (otpData.error === "EmailNotVerified") {
            setError("Your account is not verified yet.");
          } else {
            setError(otpData.error || "Invalid email or password.");
          }
          setLoading(false);
          return;
        }

        if (otpData.otpRequired) {
          setOtpMethod(otpData.method === "totp" ? "totp" : "email");
          setShowOtp(true);
          setLoading(false);
          return;
        }
        if (typeof otpData.ticket === "string") ticket = otpData.ticket;
      }

      // Step 2: Perform NextAuth signIn
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
        // Form fields: an undefined value would be sent as the string
        // "undefined" (lib/auth.config.ts credentialField), so leave it out.
        ...(showOtp ? { otp } : {}),
        ...(ticket ? { ticket } : {}),
        trustDevice: String(rememberDevice),
      });

      if (res?.error) {
        console.log("Login error detail:", res.error);
        if (res.error === "OTPRequired") {
          setShowOtp(true);
          setError("");
        } else if (res.error === "InvalidOTP") {
          setError("Invalid or expired verification code.");
        } else if (res.error === "LoginExpired") {
          setError("That sign-in took too long. Please sign in again.");
        } else if (
          res.error === "Configuration" ||
          res.error.toLowerCase().includes("invalidcredentials") ||
          res.error.toLowerCase().includes("credentialssignin")
        ) {
          // In NextAuth v5, custom errors in authorize() often result in "Configuration"
          // We provide a generic but helpful message here.
          setError("Invalid email, password, or verification code.");
        } else {
          setError(
            "Authentication failed. Please check your credentials and try again.",
          );
        }
        setLoading(false);
      } else {
        router.push(callbackUrl);
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("An unexpected error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthCard
      icon={!showOtp ? undefined : otpMethod === "totp" ? <KeyRound size={24} /> : <MailCheck size={24} />}
      title={
        !showOtp
          ? "Welcome back"
          : otpMethod === "totp"
            ? "Two-factor verification"
            : "Check your email"
      }
      description={
        !showOtp
          ? admin
            ? "Sign in to the Crypteo admin console."
            : "Sign in to your Crypteo dashboard."
          : otpMethod === "totp"
            ? "Enter the 6-digit code from your authenticator app."
            : `Enter the code we sent to ${email}.`
      }
    >
      {error && (
        <AuthAlert>
          <p>{error}</p>
          {error === "Your account is not verified yet." && (
            <Link
              href={`/verify?email=${encodeURIComponent(email)}`}
              className="mt-1 inline-block font-semibold text-sky underline underline-offset-2"
            >
              Verify my account now →
            </Link>
          )}
        </AuthAlert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {!showOtp ? (
          <>
            <div>
              <label htmlFor="login-email" className={AUTH_LABEL}>
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="login-password" className={AUTH_LABEL}>
                Password
              </label>
              <SecretInput
                id="login-password"
                autoComplete="current-password"
                required
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="login-otp" className={AUTH_LABEL}>
              Verification code
            </label>
            <CodeInput id="login-otp" value={otp} onChange={setOtp} disabled={loading} autoFocus />
            <button
              type="button"
              onClick={() => setShowOtp(false)}
              className="mt-3 cursor-pointer text-sm font-medium text-default-600 transition-colors hover:text-default-950"
            >
              ← Back to email and password
            </button>
          </div>
        )}

        <RememberDevice checked={rememberDevice} onChange={setRememberDevice} disabled={loading} />

        {!showOtp && (
          <TurnstileWidget key={captchaKey} onSuccess={setTurnstileToken} className="flex justify-center" />
        )}

        <Button
          type="submit"
          disabled={
            loading ||
            (!showOtp &&
              !turnstileToken &&
              !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
          }
          className="w-full"
          icon={loading ? <AuthSpinner /> : <ArrowRight size={18} />}
        >
          {loading
            ? showOtp
              ? "Verifying..."
              : "Signing in..."
            : showOtp
              ? "Confirm sign in"
              : "Sign in"}
        </Button>
      </form>

      <div className="mt-7 flex flex-col gap-3 text-sm text-default-600 sm:flex-row sm:items-center sm:justify-between">
        {admin ? (
          <span />
        ) : (
          <p>
            Don&apos;t have an account?{" "}
            <Link href="/register" className={AUTH_LINK}>
              Sign up
            </Link>
          </p>
        )}
        <Link href="/forgot-password" className={AUTH_LINK}>
          Forgot password?
        </Link>
      </div>
    </AuthCard>
  );
}
