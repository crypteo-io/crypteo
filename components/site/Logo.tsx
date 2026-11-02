import { cn } from "@/lib/utils";
import { useId } from "react";

/** The Crypteo mark: a "C" arc closing on a chain node. Same geometry as public/icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C2F41" />
          <stop offset="1" stopColor="#060F16" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path
        d="M21.36 11.5A7 7 0 1 0 21.36 20.5"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="22.9" cy="16" r="2.2" fill="#5AA9F5" />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
  tone = "dark",
}: {
  className?: string;
  markClassName?: string;
  tone?: "dark" | "light";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span
        className={cn(
          "font-heading text-[22px] font-semibold tracking-[-0.02em] leading-none",
          tone === "dark" ? "text-default-950" : "text-white",
        )}
      >
        Crypteo
      </span>
    </span>
  );
}
