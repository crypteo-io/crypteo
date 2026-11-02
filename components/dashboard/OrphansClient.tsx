"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import type { OrphanKind } from "@/lib/payment/orphan-review";
import { copyWithToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ArrowRight, CheckCircle2, Copy, Inbox } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { useState } from "react";

export interface OrphanRow {
  id: string;
  createdAt: string;
  chain: string;
  token: string;
  receivedAmount: number;
  walletAddress: string;
  txHash: string;
  kind: OrphanKind;
  resolvedAt: string | null;
  resolvedToPaymentId: string | null;
  notes: string | null;
  owner: { id: string; name: string } | null;
}

export const KIND_LABELS: Record<OrphanKind, { label: string; hint: string; className: string }> = {
  transaction: {
    label: "Unmatched tx",
    hint: "A transaction no open session matched.",
    className: "bg-default-100 text-default-600 border-default-200",
  },
  unattributed: {
    label: "No tx hash",
    hint: "Seen in the balance, but the transaction couldn't be identified.",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  tie: {
    label: "Tie",
    hint: "Two sessions matched this deposit equally, so neither was credited.",
    className: "bg-accent-red/5 text-accent-red border-accent-red/15",
  },
};

const th = "px-5 py-3 text-[12px] font-medium text-default-500";
const td = "px-5 py-4 text-[13px] text-default-600";

export function shortHash(hash: string) {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function OrphansClient({ rows }: { rows: OrphanRow[] }) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const open = rows.filter((r) => !r.resolvedAt);
  const shown = tab === "open" ? open : rows.filter((r) => r.resolvedAt);

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Orphan transactions"
        subtitle="Deposits that reached a merchant wallet but couldn't be matched to a payment session. Credit each to the session it paid for, or dismiss it with a reason."
      />

      <div className="frame">
      <div className="frame-inner overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-default-200 px-5 py-3.5 sm:px-6">
          <div
            role="tablist"
            aria-label="Orphan status"
            className="flex gap-1 rounded-xl border border-default-200 bg-default-100 p-1"
          >
            {(["open", "resolved"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold capitalize transition-colors cursor-pointer",
                  tab === t
                    ? "bg-white text-default-950 shadow-premium"
                    : "text-default-500 hover:text-default-900",
                )}
              >
                {t}
                {t === "open" && (
                  <span className="rounded-md bg-accent-orange/10 px-1.5 text-[11px] tabular-nums text-accent-orange">
                    {open.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-default-500">
            {shown.length} shown
          </span>
        </div>
        {shown.length === 0 ? (
          <div className="px-6 py-20 text-center">
            {tab === "open" ? (
              <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-accent-green/8 text-accent-green"><CheckCircle2 size={24} /></span>
            ) : (
              <span className="icon-tile mx-auto size-14"><Inbox className="text-default-500" size={24} /></span>
            )}
            <p className="text-default-500 font-medium mt-3">
              {tab === "open" ? "Nothing to review." : "No resolved orphans yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left stack-table">
              <thead>
                <tr className="border-b border-default-200 bg-default-50">
                  <th className={th}>Detected</th>
                  <th className={th}>Amount</th>
                  <th className={th}>Merchant</th>
                  <th className={cn(th, "hidden xl:table-cell")}>Kind</th>
                  <th className={th}>Transaction</th>
                  {tab === "resolved" && <th className={th}>Resolution</th>}
                  <th className={cn(th, "text-right")} />
                </tr>
              </thead>
              <tbody className="divide-y divide-default-100">
                {shown.map((o) => {
                  const kind = KIND_LABELS[o.kind];
                  return (
                    <tr key={o.id} className="hover:bg-default-50/80">
                      <td className={cn(td, "whitespace-nowrap")}>
                        <LocalDate value={o.createdAt} withTime />
                      </td>
                      <td data-label="Amount" className={cn(td, "whitespace-nowrap font-semibold text-default-900")}>
                        <div>
                          {o.receivedAmount}{" "}
                          <span className="uppercase text-default-500 font-medium">
                            {o.token} · {o.chain}
                          </span>
                        </div>
                      </td>
                      <td data-label="Merchant" className={td}>
                        {o.owner ? (
                          <Link href={`/merchants/${o.owner.id}`} className="font-medium text-sky hover:underline">
                            {o.owner.name}
                          </Link>
                        ) : (
                          <span className="text-default-500">No registered wallet</span>
                        )}
                      </td>
                      <td data-label="Kind" className={cn(td, "hidden xl:table-cell")}>
                        <span
                          title={kind.hint}
                          className={cn(
                            "inline-flex px-2.5 py-0.5 rounded-pill text-[11px] font-semibold capitalize border whitespace-nowrap",
                            kind.className,
                          )}
                        >
                          {kind.label}
                        </span>
                      </td>
                      <td data-label="Transaction" className={td}>
                        <button
                          onClick={() => copyWithToast(o.txHash, "Transaction reference copied")}
                          className="inline-flex items-center gap-1.5 font-mono text-[12px] hover:text-default-950 cursor-pointer"
                          title={o.txHash}
                        >
                          {shortHash(o.txHash)} <Copy size={12} />
                        </button>
                      </td>
                      {tab === "resolved" && (
                        <td data-label="Resolution" className={cn(td, "max-w-xs")}>
                          {o.resolvedToPaymentId ? (
                            <span>
                              Credited to <span className="font-mono text-[12px]">{o.resolvedToPaymentId}</span>
                            </span>
                          ) : (
                            <span>Dismissed: {o.notes}</span>
                          )}
                        </td>
                      )}
                      <td data-actions className={cn(td, "text-right")}>
                        <Link
                          href={`/orphans/${o.id}`}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-default-200 text-[13px] font-semibold text-default-700 bg-white hover:bg-default-50 hover:text-default-950"
                        >
                          {o.resolvedAt ? "View" : "Review"} <ArrowRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
