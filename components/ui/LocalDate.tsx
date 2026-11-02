"use client";

import { useIsClient } from "@/components/ui/useIsClient";

/**
 * A date in the viewer's locale and time zone.
 *
 * toLocaleString() on the server uses the container's locale and UTC, so the
 * server HTML and the first client render disagree ("Sep 30, 02:47" vs
 * "30 Sept, 04:47") and React throws a hydration error. Silencing the warning
 * would keep the server's text — the wrong zone for everyone not on UTC. So
 * the server and hydration render a fixed, unambiguous UTC stamp, and the
 * browser swaps in the local rendering right after.
 */
export function LocalDate({
  value,
  options,
  withTime = false,
}: {
  value: string | Date;
  options?: Intl.DateTimeFormatOptions;
  // Without `options`, choose between a date-only and a date+time rendering.
  withTime?: boolean;
}) {
  const isClient = useIsClient();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const iso = date.toISOString();
  const text = isClient
    ? withTime || options?.hour !== undefined
      ? date.toLocaleString(undefined, options)
      : date.toLocaleDateString(undefined, options)
    : `${iso.slice(0, 10)}${withTime || options?.hour !== undefined ? ` ${iso.slice(11, 16)} UTC` : ""}`;

  return (
    <time dateTime={iso} title={iso}>
      {text}
    </time>
  );
}
