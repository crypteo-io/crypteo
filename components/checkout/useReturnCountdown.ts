"use client";

import { useEffect, useState } from "react";

const RETURN_DELAY_SECONDS = 5;

/**
 * Counts down, then sends the buyer to the merchant's page (a payment's
 * successUrl). Null when there is nowhere to go or it isn't time yet.
 */
export function useReturnCountdown(url: string | null | undefined, active: boolean): number | null {
  const [left, setLeft] = useState(RETURN_DELAY_SECONDS);
  const running = !!url && active;
  useEffect(() => {
    if (!running || !url) return;
    if (left <= 0) {
      window.location.assign(url);
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [running, url, left]);
  return running ? Math.max(left, 0) : null;
}
