"use client";

import { cn } from "@/lib/utils";

const LOW_TIME_SECONDS = 300;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/** Time left in the session as a slim draining bar with mm:ss beside it. */
export function CountdownBar({
  timeLeft,
  totalSeconds = 3600,
  label = "Rate locked for",
  className,
}: {
  timeLeft: number;
  totalSeconds?: number;
  label?: string;
  className?: string;
}) {
  const isLowTime = timeLeft < LOW_TIME_SECONDS;
  const remainingRatio = Math.max(0, Math.min(1, timeLeft / totalSeconds));

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-default-500">{label}</span>
        <span
          // The remaining time is computed from the clock on both server
          // and client, so the rendered seconds legitimately differ.
          suppressHydrationWarning
          className={cn(
            "font-heading text-base font-semibold tabular-nums",
            isLowTime ? "text-accent-orange" : "text-default-900",
          )}
        >
          {formatTime(timeLeft)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-default-200">
        <div
          suppressHydrationWarning
          className={cn(
            "h-full rounded-full transition-[width] duration-1000 ease-linear",
            isLowTime ? "bg-accent-orange" : "bg-ck-ink",
          )}
          style={{ width: `${remainingRatio * 100}%` }}
        />
      </div>
    </div>
  );
}
