"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { useIsClient } from "@/components/ui/useIsClient";
import { useState } from "react";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

/**
 * "5 min ago" for recent events, a short date beyond a week. The server has no
 * idea of the viewer's clock, so SSR and hydration render the fixed LocalDate
 * stamp and the browser swaps in the relative text.
 */
export function RelativeTime({ value }: { value: string | Date }) {
  const isClient = useIsClient();
  // Read once per mount: the text is a snapshot, not a ticking clock.
  const [now] = useState(() => Date.now());
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (!isClient) return <LocalDate value={value} options={{ month: "short", day: "numeric" }} />;

  const elapsed = now - date.getTime();
  let text: string;
  if (elapsed < MINUTE_MS) text = "just now";
  else if (elapsed < HOUR_MS) text = `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  else if (elapsed < DAY_MS) text = `${Math.floor(elapsed / HOUR_MS)} h ago`;
  else if (elapsed < RELATIVE_LIMIT_MS) {
    const days = Math.floor(elapsed / DAY_MS);
    text = days === 1 ? "yesterday" : `${days} days ago`;
  } else {
    text = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {text}
    </time>
  );
}
