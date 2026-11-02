"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { apiRequest } from "@/lib/api-client";
import { cycleLabel, invoicePeriodLabel, ordinal } from "@/lib/billing/cycle";
import { formatUsd, type FeeCopy } from "@/lib/billing/fee-schedule";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { CalendarClock, CreditCard, Percent, Receipt, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface StatementRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  paymentCount: number;
  volumeUsd: number;
  ratePercent: number;
  feeUsd: number;
  carriedInUsd: number;
  accruingSince: string | null;
  amountDueUsd: number;
  status: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
}

interface Data {
  now: string;
  exempt: boolean;
  /** The day of the month this merchant's billing months start (UTC). */
  anchorDay: number | null;
  billingEnabled: boolean;
  holdSince: string | null;
  copy: FeeCopy;
  estimate: {
    cycleStart: string;
    cycleEnd: string;
    volumeUsd: number;
    unpriced: number;
    ratePercent: number;
    feeUsd: number;
  } | null;
  /** Owed but not invoiced yet: under the minimum, or not yet due on the 3-month cadence. */
  carriedUsd: number;
  statements: StatementRow[];
}

const th = "px-5 py-3 text-[12px] font-medium text-default-500";
const td = "px-5 py-4 text-[13px] text-default-600 whitespace-nowrap";

export const periodLabel = (s: { periodStart: string; periodEnd: string }) => cycleLabel(s.periodStart, s.periodEnd);

export function StatementStatus({
  row,
  now,
}: {
  row: Pick<StatementRow, "status" | "dueAt" | "amountDueUsd">;
  /** The server's clock (ISO), so the server and browser render agree. */
  now: string;
}) {
  const overdue = row.status === "open" && row.dueAt && row.dueAt < now;
  const [label, className] =
    row.status === "paid"
      ? ["Paid", "bg-accent-green/10 text-accent-green border-accent-green/20"]
      : row.status === "waived"
        ? ["Waived", "bg-default-100 text-default-500 border-default-200"]
        : row.status === "carried"
          ? [row.amountDueUsd > 0 ? "Carried forward" : "Nothing due", "bg-default-100 text-default-500 border-default-200"]
          : overdue
            ? ["Overdue", "bg-accent-red/10 text-accent-red border-accent-red/20"]
            : ["Due", "bg-accent-orange/10 text-accent-orange border-accent-orange/20"];
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[12px] font-medium", className)}>
      {label}
    </span>
  );
}

export function BillingClient({ data }: { data: Data }) {
  const router = useRouter();
  const [paying, setPaying] = useState<string | null>(null);

  const pay = async (id: string) => {
    setPaying(id);
    try {
      const { checkoutUrl } = await toast.promise(
        apiRequest<{ checkoutUrl: string }>(`/api/billing/statements/${id}/pay`, { method: "POST" }),
        { loading: "Opening payment page…", success: "Choose USDT or USDC to pay", error: "Couldn't open the payment page" },
      );
      router.push(checkoutUrl);
    } catch {
      setPaying(null);
    }
  };

  const open = data.statements.filter((s) => s.status === "open");
  const owed = open.reduce((s, o) => s + o.amountDueUsd, 0);

  return (
    <div className="space-y-8 pb-12">
      <PageHeader title="Billing" subtitle="Platform fees, invoices and payments." />

      {data.exempt ? (
        <div className="frame">
        <div className={cn("frame-inner h-full", "p-6 text-[14px] text-default-600")}>
          This account isn&apos;t charged platform fees.
        </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              icon={Receipt}
              label="Outstanding"
              value={formatUsd(owed)}
              hint={
                open.length
                  ? `${open.length} open invoice${open.length === 1 ? "" : "s"}`
                  : data.carriedUsd > 0
                    ? `Nothing to pay yet · ${formatUsd(data.carriedUsd)} carried forward`
                    : "Nothing to pay"
              }
              tone={data.holdSince ? "danger" : owed > 0 ? "warning" : undefined}
            />
            <MetricCard
              icon={CalendarClock}
              label="This billing month so far"
              value={data.estimate ? formatUsd(data.estimate.feeUsd) : "–"}
              hint={
                data.estimate
                  ? `${cycleLabel(data.estimate.cycleStart, data.estimate.cycleEnd)} · ${formatUsd(data.estimate.volumeUsd)} in sales at ${data.estimate.ratePercent}%${data.estimate.unpriced ? ` · ${data.estimate.unpriced} crypto-priced sale(s) valued at month end` : ""}`
                  : data.billingEnabled
                    ? "Not available right now"
                    : "Billing hasn't started"
              }
            />
            <MetricCard
              icon={Percent}
              label="Your rate"
              value={data.copy.range}
              hint={data.copy.monthlyCap ? `Capped at ${data.copy.monthlyCap} a month` : "Of each month's paid volume"}
            />
          </div>

          {open.length > 0 && (
            <section className="frame">
            <div className={cn("frame-inner h-full", "p-5 sm:p-6 space-y-4")}>
              <h2 className="font-heading text-[18px] font-semibold text-default-950">Pay your invoice</h2>
              <p className="text-[14px] text-default-500 max-w-2xl">
                Pay with USDT or USDC on any network offered at checkout. Your invoice is marked paid
                within minutes of the transfer confirming
                {data.holdSince ? ", and your checkouts resume at the same moment." : "."}
              </p>
              <div className="divide-y divide-default-100 border border-default-200 rounded-xl">
                {open.map((s) => (
                  <div key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between p-4">
                    <div>
                      <p className="font-heading text-[15px] font-semibold text-default-950">
                        {formatUsd(s.amountDueUsd)} · {invoicePeriodLabel(s)}
                      </p>
                      <p className="text-[12px] text-default-500 mt-0.5">
                        Due {s.dueAt ? <LocalDate value={s.dueAt} withTime /> : "–"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatementStatus row={s} now={data.now} />
                      <button
                        onClick={() => void pay(s.id)}
                        disabled={paying !== null}
                        className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary-deep disabled:opacity-50 cursor-pointer"
                      >
                        <Wallet size={14} /> {paying === s.id ? "Opening…" : "Pay now"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </section>
          )}

          <section className="frame">
            <div className="frame-inner overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-default-200 px-5 py-4 sm:px-6">
              <CreditCard size={16} className="text-default-400" />
              <h2 className="font-heading text-[16px] font-semibold text-default-950">Statements</h2>
            </div>
            {data.statements.length === 0 ? (
              <p className="px-6 py-8 text-[13px] text-default-500">
                No statements yet. Fees are calculated when each billing month ends
                {data.anchorDay ? ` (on the ${ordinal(data.anchorDay)} of each month, UTC)` : ""}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left stack-table">
                  <thead>
                    <tr className="border-b border-default-200 bg-default-50">
                      <th className={th}>Billing month</th>
                      <th className={th}>Paid sales</th>
                      <th className={cn(th, "hidden xl:table-cell")}>Rate</th>
                      <th className={th}>Fee</th>
                      <th className={cn(th, "hidden xl:table-cell")}>Carried in</th>
                      <th className={th}>Amount due</th>
                      <th className={cn(th, "text-right")}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default-100">
                    {data.statements.map((s) => (
                      <tr key={s.id}>
                        <td className={cn(td, "font-medium text-default-900")}>{periodLabel(s)}</td>
                        <td data-label="Paid sales" className={td}>
                          {formatUsd(s.volumeUsd)} <span className="text-default-400">({s.paymentCount})</span>
                        </td>
                        <td data-label="Rate" className={cn(td, "hidden xl:table-cell")}>{s.ratePercent}%</td>
                        <td data-label="Fee" className={td}>{formatUsd(s.feeUsd)}</td>
                        <td data-label="Carried in" className={cn(td, "hidden xl:table-cell")}>{s.carriedInUsd ? formatUsd(s.carriedInUsd) : "–"}</td>
                        <td data-label="Amount due" className={cn(td, "font-semibold text-default-900")}>{formatUsd(s.amountDueUsd)}</td>
                        <td data-label="Status" className={cn(td, "text-right")}>
                          <StatementStatus row={s} now={data.now} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </section>

          <section className="frame">
          <div className={cn("frame-inner h-full", "p-5 sm:p-6 text-[14px] leading-relaxed text-default-600 space-y-2")}>
            <h2 className="font-heading text-[16px] font-semibold text-default-950">How fees work</h2>
            <p>
              Your billing month runs from the {data.anchorDay ? ordinal(data.anchorDay) : "day you joined"} of one month
              to the same day of the next (UTC; the last day in shorter months). At its end your paid sales are added up and
              charged one rate: {data.copy.tiers
                .map((t, i) => `${t.percent}%${i === 0 ? "" : ` from ${formatUsd(t.fromUsd)}`}`)
                .join(", ")}
              {data.copy.monthlyCap ? `, capped at ${data.copy.monthlyCap} a month` : ""}.
            </p>
            <p>{data.copy.invoicing}</p>
            <p>
              An invoice is due 7 days after it&apos;s issued. We remind you 3 days and 24 hours before. If it&apos;s
              still unpaid at the due date, your checkouts pause until it is paid.
            </p>
          </div>
          </section>
        </>
      )}
    </div>
  );
}
