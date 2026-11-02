import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/** A labelled figure with a one-line caveat: the admin and billing KPI tiles. */
export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "warning" | "danger";
}) {
  return (
    <div className="frame">
      <div className="frame-inner h-full p-5">
      <div className="flex items-center gap-2.5 text-[13px] font-medium text-default-500">
        <span className="flex size-8 items-center justify-center rounded-lg bg-sky/8 text-sky">
          <Icon size={16} />
        </span>
        {label}
      </div>
      <p
        className={cn(
          "font-heading text-[24px] font-semibold tabular-nums tracking-[-0.02em] mt-3",
          tone === "danger"
            ? "text-accent-red"
            : tone === "warning"
              ? "text-orange-600"
              : tone === "good"
                ? "text-accent-green"
                : "text-default-950",
        )}
      >
        {value}
      </p>
      <p className="text-[12px] text-default-500 mt-1">{hint}</p>
      </div>
    </div>
  );
}
