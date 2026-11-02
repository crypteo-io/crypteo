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
  RememberDevice,
} from "@/components/auth/AuthCard";
import { Button } from "@/components/site/Button";
import { toast } from "@/lib/toast";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [otp, setOtp] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Initialize cooldown from localStorage on mount
  useEffect(() => {
    const lastResend = localStorage.getItem(`lastResend_${email}`);
    if (lastResend) {
      const remaining = Math.ceil(
        60 - (Date.now() - parseInt(lastResend)) / 1000,
      );
      if (remaining > 0) {
        setCooldown(remaining);
      }
    }
  }, [email]);

  // Timer interval
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleVerify = async (e: React.FormEvent) => {
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
      if (!res.ok) throw new Error(data.error || "Verification failed");

      setSuccess(true);
      setTimeout(() => router.push("/login?verified=true"), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email || cooldown > 0) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to resend code");
      }

      localStorage.setItem(`lastResend_${email}`, Date.now().toString());
      setCooldown(60);
      toast.success("New code sent", `Check ${email} (and your spam folder).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      icon={<ShieldCheck size={24} />}
      title="Verify your account"
      description={
        success
          ? "Verification successful."
          : email
            ? `Enter the 6-digit code we sent to ${email}.`
            : "Enter your email and the 6-digit code we sent you."
      }
    >
      {error && (
        <AuthAlert>
          <p>{error}</p>
        </AuthAlert>
      )}

      {success && (
        <AuthAlert tone="success">
          <p>Account verified. Taking you to sign in...</p>
        </AuthAlert>
      )}

      {!success && (
        <form onSubmit={handleVerify} className="space-y-5">
          {!email && (
            <div>
              <label htmlFor="verify-email" className={AUTH_LABEL}>
                Email
              </label>
              <input
                id="verify-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
                placeholder="you@company.com"
              />
            </div>
          )}

          <div>
            <label htmlFor="verify-otp" className={AUTH_LABEL}>
              Verification code
            </label>
            <CodeInput id="verify-otp" value={otp} onChange={setOtp} disabled={loading} />
          </div>

          <RememberDevice checked={rememberDevice} onChange={setRememberDevice} disabled={loading} />

          <Button
            type="submit"
            disabled={loading || otp.length < 6}
            className="w-full"
            icon={loading ? <AuthSpinner /> : <ArrowRight size={18} />}
          >
            {loading ? "Verifying..." : "Verify account"}
          </Button>

          <div className="flex flex-col gap-3 pt-1 text-sm sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={handleResend}
              disabled={loading || !email || cooldown > 0}
              className="cursor-pointer text-left font-medium text-default-600 transition-colors hover:text-default-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cooldown > 0
                ? `Resend code in ${cooldown}s`
                : "Didn't get a code? Resend"}
            </button>
            <Link href="/login" className={AUTH_LINK}>
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

export default function VerifyPage() {
  return (
    <AuthScreen>
      <Suspense fallback={<AuthCardSkeleton />}>
        <VerifyContent />
      </Suspense>
    </AuthScreen>
  );
}
