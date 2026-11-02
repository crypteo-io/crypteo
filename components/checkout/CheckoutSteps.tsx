import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

type StepState = "done" | "current" | "upcoming" | "failed";

function Step({ n, label, state }: { n: number; label: string; state: StepState }) {
  return (
    <div className="flex items-center gap-2 sm:gap-1.5">
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-[13px] font-semibold sm:size-5 sm:text-[11px]",
          state === "current" && "bg-ck text-on-ck",
          state === "done" && "bg-ck-ink/10 text-ck-ink",
          state === "upcoming" && "border border-default-200 bg-white text-default-400",
          state === "failed" && "bg-default-200 text-default-600",
        )}
      >
        {state === "done" ? (
          <Check size={12} strokeWidth={3} />
        ) : state === "failed" ? (
          <X size={12} strokeWidth={3} />
        ) : (
          n
        )}
      </span>
      <span
        className={cn(
          "text-sm font-semibold sm:text-xs",
          state === "current" || state === "failed" ? "text-default-900" : "text-default-500",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/** Select → Pay progress shown at the top of the checkout card. */
export function CheckoutSteps({ current }: { current: "select" | "pay" | "expired" }) {
  return (
    <div className="flex items-center gap-2">
      <Step n={1} label="Select" state={current === "select" ? "current" : "done"} />
      <span className="h-px w-6 bg-default-200 sm:w-5" />
      <Step
        n={2}
        label={current === "expired" ? "Expired" : "Pay"}
        state={current === "select" ? "upcoming" : current === "pay" ? "current" : "failed"}
      />
    </div>
  );
}

export function TestModeBadge() {
  return (
    <span className="rounded-md border border-accent-red/25 bg-accent-red/10 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-accent-red uppercase">
      Test mode
    </span>
  );
}
