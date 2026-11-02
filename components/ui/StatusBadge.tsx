"use client";

import { cn } from "@/lib/utils";

const statusConfig: Record<
  string,
  {
    color: string;
    bg: string;
    border: string;
    pulse: boolean;
    dot: string;
    label?: string;
  }
> = {
  pending: {
    color: "text-sky",
    bg: "bg-sky/5",
    border: "border-sky/15",
    pulse: true,
    dot: "bg-sky-soft",
  },
  confirming: {
    color: "text-sky",
    bg: "bg-sky/10",
    border: "border-sky/20",
    pulse: true,
    dot: "bg-sky",
  },
  confirmed: {
    color: "text-accent-green",
    bg: "bg-accent-green/5",
    border: "border-accent-green/15",
    pulse: false,
    dot: "bg-accent-green",
  },
  underpaid: {
    color: "text-accent-orange",
    bg: "bg-accent-orange/5",
    border: "border-accent-orange/15",
    pulse: false,
    dot: "bg-accent-orange",
  },
  overpaid: {
    color: "text-primary",
    bg: "bg-primary/5",
    border: "border-primary/15",
    pulse: false,
    dot: "bg-primary",
  },
  expired: {
    color: "text-default-500",
    bg: "bg-default-100",
    border: "border-default-200",
    pulse: false,
    dot: "bg-accent-orange",
  },
  // Funds arrived after expiry (inside the grace window). Money is on the
  // merchant's wallet and needs attention — not "pending", not "expired".
  expired_received: {
    color: "text-accent-orange",
    bg: "bg-accent-orange/10",
    border: "border-accent-orange/25",
    pulse: false,
    dot: "bg-accent-orange",
    label: "Late payment",
  },
};

function sentenceCase(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ status }: { status: string }) {
  // Unknown statuses render neutrally under their own name — never disguised
  // as another status.
  const cfg = statusConfig[status] || {
    color: "text-default-600",
    bg: "bg-default-50",
    border: "border-default-200",
    pulse: false,
    dot: "bg-default-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap text-[12px] font-semibold px-2.5 py-0.5 rounded-pill border gap-1.5",
        cfg.color,
        cfg.bg,
        cfg.border,
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          cfg.dot,
          cfg.pulse && "animate-pulse-slow",
        )}
      />
      {sentenceCase(cfg.label ?? status.replaceAll("_", " "))}

      <style jsx>{`
        @keyframes pulse-slow {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </span>
  );
}
