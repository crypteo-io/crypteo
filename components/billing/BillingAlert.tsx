"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { formatUsd } from "@/lib/billing/fee-schedule";
import type { BillingAlertData } from "@/lib/billing/merchant-view";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight, Receipt, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DAY_MS } from "@/lib/time";

/**
 * Top-of-dashboard notice of fees owed and of the billing hold they lead to.
 * Shown on every dashboard page: a merchant who never opens Billing still has
 * to see that their checkouts are about to stop (or have stopped).
 */
export function BillingAlert({ data, now }: { data: BillingAlertData; now: string }) {
  const pathname = usePathname();
  if (!data.holdSince && data.open.length === 0) return null;

  const total = data.open.reduce((s, o) => s + o.amountDueUsd, 0);
  const next = data.open[0];
  const msLeft = next?.dueAt ? new Date(next.dueAt).getTime() - new Date(now).getTime() : null;
  const tone = data.holdSince ? "danger" : msLeft !== null && msLeft <= 3 * DAY_MS ? "warning" : "info";

  const styles = {
    danger: "border-accent-red/30 bg-accent-red/5",
    warning: "border-accent-orange/30 bg-accent-orange/5",
    info: "border-sky/20 bg-sky/5",
  }[tone];
  const Icon = tone === "danger" ? ShieldAlert : tone === "warning" ? AlertTriangle : Receipt;
  const iconClass = {
    danger: "text-accent-red",
    warning: "text-accent-orange",
    info: "text-sky",
  }[tone];

  return (
    <div role="alert" className={cn("mb-6 flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border p-5", styles)}>
      <Icon size={22} className={cn("shrink-0", iconClass)} />
      <div className="min-w-0 flex-1 text-[14px] text-default-700">
        {data.holdSince ? (
          <>
            <p className="font-semibold text-default-950">Your checkouts are paused: platform fees are overdue</p>
            <p className="mt-1">
              Buyers can&apos;t start a payment until {formatUsd(total)} is paid. Payments already in
              progress are still watched and credited. Checkouts resume within minutes of your payment confirming.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold text-default-950">
              {formatUsd(total)} in platform fees due
              {next?.dueAt && (
                <>
                  {" "}by <LocalDate value={next.dueAt} options={{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }} />
                </>
              )}
            </p>
            <p className="mt-1">
              Pay in USDT or USDC before the due date. After it, your checkouts stop accepting payments until the
              invoice is paid.
            </p>
          </>
        )}
      </div>
      {pathname !== "/dashboard/billing" && (
        <Link
          href="/dashboard/billing"
          className={cn(
            "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold shrink-0 transition-colors",
            tone === "danger" ? "bg-accent-red text-white hover:bg-accent-red/90" : "bg-primary text-white hover:bg-primary-deep",
          )}
        >
          Pay now <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}
