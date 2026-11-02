"use client";

import { CodeInput } from "@/components/ui/CodeInput";
import {
  AUTH_LABEL,
  AUTH_LINK,
  AuthAlert,
  AuthCard,
  AuthScreen,
  AuthSpinner,
  RememberDevice,
} from "@/components/auth/AuthCard";
import { SelfCustodyTip } from "@/components/SelfCustodyTip";
import { Button } from "@/components/site/Button";
import TurnstileWidget from "@/components/TurnstileWidget";
import { isReservedName, RESERVED_NAME_MESSAGE } from "@/lib/reserved-names";
import { isStrongPassword, passwordErrorMessage } from "@/lib/validation";
import { ArrowRight, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SecretInput } from "@/components/ui/SecretInput";

export default function RegisterPage() {
  const [step, setStep] = useState(1); // 1: Details, 2: OTP
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const router = useRouter();

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReservedName(name)) {
      setError(RESERVED_NAME_MESSAGE);
      return;
    }
    if (!isStrongPassword(password)) {
      setError(passwordErrorMessage);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);

    if (!turnstileToken && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      setError("Please complete the captcha");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/register/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to send verification code");
      }

      setStep(2);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, trustDevice: rememberDevice }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      router.push("/login?registered=true");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen>
      <AuthCard
        top={step === 1 ? <SelfCustodyTip /> : undefined}
        icon={step === 2 ? <MailCheck size={24} /> : undefined}
        title={step === 1 ? "Create your account" : "Check your email"}
        description={
          step === 1
            ? "Start accepting non-custodial crypto payments in minutes."
            : `Enter the 6-digit code we sent to ${email}.`
        }
      >
        {error && (
          <AuthAlert>
            <p>{error}</p>
          </AuthAlert>
        )}

        {step === 1 ? (
          <form onSubmit={handleRequestOtp} className="space-y-5">
            <div>
              <label htmlFor="register-name" className={AUTH_LABEL}>
                Company or name
              </label>
              <input
                id="register-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="field"
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label htmlFor="register-email" className={AUTH_LABEL}>
                Work email
              </label>
              <input
                id="register-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="field"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="register-password" className={AUTH_LABEL}>
                Password
              </label>
              <SecretInput
                id="register-password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="field"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label htmlFor="register-confirm" className={AUTH_LABEL}>
                Confirm password
              </label>
              <SecretInput
                revealLabel="confirmation"
                id="register-confirm"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                className="field"
                placeholder="••••••••"
              />
            </div>

            <TurnstileWidget onSuccess={setTurnstileToken} className="flex justify-center" />

            <Button
              type="submit"
              disabled={loading || !turnstileToken}
              className="w-full"
              icon={loading ? <AuthSpinner /> : <ArrowRight size={18} />}
            >
              {loading ? "Creating account..." : "Continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-5">
            <div>
              <label htmlFor="register-otp" className={AUTH_LABEL}>
                Verification code
              </label>
              <CodeInput id="register-otp" value={otp} onChange={setOtp} disabled={loading} />
            </div>

            <RememberDevice checked={rememberDevice} onChange={setRememberDevice} disabled={loading} />

            <Button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full"
              icon={loading ? <AuthSpinner /> : <ArrowRight size={18} />}
            >
              {loading ? "Verifying..." : "Create account"}
            </Button>

            <button
              type="button"
              onClick={() => setStep(1)}
              className="cursor-pointer text-sm font-medium text-default-600 transition-colors hover:text-default-950"
            >
              ← Back to your details
            </button>
          </form>
        )}

        <p className="mt-7 text-sm text-default-600">
          Already have an account?{" "}
          <Link href="/login" className={AUTH_LINK}>
            Sign in
          </Link>
        </p>
      </AuthCard>
    </AuthScreen>
  );
}
