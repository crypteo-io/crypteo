"use client";

import { Turnstile } from "@marsidev/react-turnstile";

interface Props {
  onSuccess: (token: string) => void;
  onError?: () => void;
  className?: string;
}

export default function TurnstileWidget({ onSuccess, onError, className }: Props) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Passing an empty/undefined siteKey to <Turnstile> throws an uncaught
  // TurnstileError and the widget never mounts, which can lock users out of
  // forms that gate submission on a token. Render nothing when unconfigured
  // so those forms fall back to their no-captcha path.
  if (!siteKey) return null;

  // Forced light: "auto" follows the OS and renders a dark widget on our light pages.
  return (
    <div className={className}>
      <Turnstile siteKey={siteKey} onSuccess={onSuccess} onError={onError} options={{ theme: "light" }} />
    </div>
  );
}
