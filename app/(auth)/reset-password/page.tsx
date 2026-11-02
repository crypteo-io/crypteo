"use client";

import { CodeInput } from "@/components/ui/CodeInput";
import {
  AUTH_LABEL,
  AUTH_LINK,
  AuthAlert,
  AuthCard,
  AuthCardSkeleton,
  AuthScreen,
  AuthSpinner,
} from "@/components/auth/AuthCard";
import { Button, ButtonLink } from "@/components/site/Button";
import TurnstileWidget from "@/components/TurnstileWidget";
import { isStrongPassword, passwordErrorMessage } from "@/lib/validation";
import { ArrowRight, CheckCircle, Lock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SecretInput } from "@/components/ui/SecretInput";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!isStrongPassword(password)) {
      setError(passwordErrorMessage);
      return;
    }

    if (!turnstileToken && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      setError("Please complete the captcha");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, password, turnstileToken }),
      });
      if (res.ok) setDone(true);
      else {
        const data = await res.json();
        setError(data.error || "Reset failed.");
      }
    } catch {
      setError("Network error.");
    }
    setLoading(false);
  };

  return (
    <AuthCard
      icon={done ? <CheckCircle size={24} /> : <Lock size={24} />}
      title={done ? "Password updated" : "Reset your password"}
      description={
        done
          ? "You can now sign in with your new password."
          : "Enter the code from your email and choose a new password."
      }
    >
      {done ? (
        <ButtonLink href="/login" className="w-full" icon={<ArrowRight size={18} />}>
          Sign in now
        </ButtonLink>
      ) : (
        <>
          {error && (
            <AuthAlert>
              <p>{error}</p>
            </AuthAlert>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="reset-email" className={AUTH_LABEL}>
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="field"
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="reset-otp" className={AUTH_LABEL}>
                Reset code
              </label>
              <CodeInput id="reset-otp" value={otp} onChange={setOtp} disabled={loading} />
            </div>
            <div>
              <label htmlFor="reset-password" className={AUTH_LABEL}>
                New password
              </label>
              <SecretInput
                id="reset-password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="field"
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="reset-confirm" className={AUTH_LABEL}>
                Confirm new password
              </label>
              <SecretInput
                revealLabel="confirmation"
                id="reset-confirm"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="field"
                disabled={loading}
              />
            </div>
            <TurnstileWidget onSuccess={setTurnstileToken} className="flex justify-center" />

            <Button
              type="submit"
              disabled={loading || otp.length < 6 || !turnstileToken}
              className="w-full"
              icon={loading ? <AuthSpinner /> : <ArrowRight size={18} />}
            >
              {loading ? "Updating..." : "Update password"}
            </Button>
          </form>
          <p className="mt-7 text-sm text-default-600">
            Need a new code?{" "}
            <Link href="/forgot-password" className={AUTH_LINK}>
              Send another
            </Link>
          </p>
        </>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthScreen>
      <Suspense fallback={<AuthCardSkeleton />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthScreen>
  );
}
