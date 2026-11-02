"use client";

import { AUTH_LABEL, AUTH_LINK, AuthAlert, AuthCard, AuthScreen, AuthSpinner } from "@/components/auth/AuthCard";
import { Button, ButtonLink } from "@/components/site/Button";
import TurnstileWidget from "@/components/TurnstileWidget";
import { ArrowRight, Mail, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!turnstileToken && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      setError("Please complete the captcha");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      if (res.ok) setSent(true);
      else {
        const data = await res.json();
        setError(data.error || "Failed to send reset email. Try again.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen>
      <AuthCard
        icon={sent ? <MailCheck size={24} /> : <Mail size={24} />}
        title={sent ? "Check your inbox" : "Forgot your password?"}
        description={
          sent ? (
            <>
              If an account exists for <strong className="text-default-900">{email}</strong>,
              we&apos;ve sent a 6-digit reset code.
            </>
          ) : (
            "Enter your email and we'll send you a code to reset it."
          )
        }
      >
        {sent ? (
          <div className="space-y-5">
            <ButtonLink
              href={`/reset-password?email=${encodeURIComponent(email)}`}
              className="w-full"
              icon={<ArrowRight size={18} />}
            >
              Enter reset code
            </ButtonLink>
            <button
              onClick={() => setSent(false)}
              className="cursor-pointer text-sm font-medium text-default-600 transition-colors hover:text-default-950"
            >
              Didn&apos;t get it? Try again
            </button>
          </div>
        ) : (
          <>
            {error && (
              <AuthAlert>
                <p>{error}</p>
              </AuthAlert>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="forgot-email" className={AUTH_LABEL}>
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={loading}
                  className="field"
                />
              </div>

              <TurnstileWidget onSuccess={setTurnstileToken} className="flex justify-center" />

              <Button
                type="submit"
                disabled={loading || !turnstileToken}
                className="w-full"
                icon={loading ? <AuthSpinner /> : <ArrowRight size={18} />}
              >
                {loading ? "Sending..." : "Send reset code"}
              </Button>
            </form>
            <p className="mt-7 text-sm text-default-600">
              Remembered it?{" "}
              <Link href="/login" className={AUTH_LINK}>
                Sign in
              </Link>
            </p>
          </>
        )}
      </AuthCard>
    </AuthScreen>
  );
}
