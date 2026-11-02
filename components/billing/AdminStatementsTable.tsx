"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { apiRequest, ApiError } from "@/lib/api-client";
import { formatUsd } from "@/lib/billing/fee-schedule";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CalendarPlus, CheckCircle2, Eraser } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { invoicePeriodLabel } from "@/lib/billing/cycle";
import { periodLabel, StatementStatus, type StatementRow } from "./BillingClient";

export interface AdminStatementRow extends StatementRow {
  merchant?: { id: string; name: string; email: string };
  note: string | null;
  resolvedBy: string | null;
}

type Action = "markPaid" | "waive" | "extend";

const COPY: Record<Action, { title: string; body: string; cta: string; danger?: boolean }> = {
  markPaid: {
    title: "Mark this invoice paid?",
    body: "For a payment you verified outside the checkout (e.g. a direct transfer). The merchant is notified and any billing hold lifts.",
    cta: "Mark paid",
  },
  waive: {
    title: "Waive this invoice?",
    body: "Nothing is owed for it any more. The merchant is notified and any billing hold lifts.",
    cta: "Waive",
    danger: true,
  },
  extend: {
    title: "Give more time?",
    body: "Moves the due date. Any billing hold lifts now and comes back only if the new date passes unpaid.",
    cta: "Extend",
  },
};

const th = "px-5 py-3 text-[12px] font-medium text-default-500";
const td = "px-5 py-4 text-[13px] text-default-600 whitespace-nowrap";

export function AdminStatementsTable({
  rows,
  now,
  showMerchant = true,
  empty = "No statements yet.",
}: {
  rows: AdminStatementRow[];
  now: string;
  showMerchant?: boolean;
  empty?: string;
}) {
  const [acting, setActing] = useState<{ row: AdminStatementRow; action: Action } | null>(null);

  if (rows.length === 0) return <p className="px-6 py-8 text-[13px] text-default-500">{empty}</p>;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left stack-table">
          <thead>
            <tr className="border-b border-default-200 bg-default-50">
              {showMerchant && <th className={th}>Merchant</th>}
              <th className={th}>Billing month</th>
              <th className={cn(th, "hidden xl:table-cell")}>Sales</th>
              <th className={cn(th, "hidden xl:table-cell")}>Rate</th>
              <th className={th}>Due</th>
              <th className={th}>Due date</th>
              <th className={th}>Status</th>
              <th className={cn(th, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                {showMerchant && (
                  <td className={td}>
                    {r.merchant ? (
                      <Link href={`/merchants/${r.merchant.id}`} className="font-semibold text-default-900 hover:underline">
                        {r.merchant.name}
                      </Link>
                    ) : (
                      "–"
                    )}
                    {r.merchant && <p className="text-[11px] text-default-500">{r.merchant.email}</p>}
                  </td>
                )}
                <td data-label="Billing month" className={cn(td, "font-medium text-default-900")}>{periodLabel(r)}</td>
                <td data-label="Sales" className={cn(td, "hidden xl:table-cell")}>
                  {formatUsd(r.volumeUsd)} <span className="text-default-400">({r.paymentCount})</span>
                </td>
                <td data-label="Rate" className={cn(td, "hidden xl:table-cell")}>{r.ratePercent}%</td>
                <td data-label="Due" className={cn(td, "font-semibold text-default-900")}>
                  <div>
                    {formatUsd(r.amountDueUsd)}
                    {r.carriedInUsd > 0 && (
                      <p className="text-[11px] font-normal text-default-400">incl. {formatUsd(r.carriedInUsd)} carried</p>
                    )}
                  </div>
                </td>
                <td data-label="Due date" className={td}>{r.dueAt ? <LocalDate value={r.dueAt} withTime /> : "–"}</td>
                <td data-label="Status" className={td}>
                  <div>
                    <StatementStatus row={r} now={now} />
                    {(r.note || r.resolvedBy) && (
                      <p className="text-[11px] text-default-500 mt-1 max-w-[220px] whitespace-normal">
                        {r.note}
                        {r.resolvedBy && `, by ${r.resolvedBy}`}
                      </p>
                    )}
                  </div>
                </td>
                <td data-actions className={cn(td, "text-right")}>
                  {(r.status === "open" || r.status === "carried") && (
                    <div className="inline-flex gap-1.5">
                      <IconButton icon={CheckCircle2} label="Mark paid" onClick={() => setActing({ row: r, action: "markPaid" })} />
                      {r.status === "open" && (
                        <IconButton icon={CalendarPlus} label="Extend" onClick={() => setActing({ row: r, action: "extend" })} />
                      )}
                      <IconButton icon={Eraser} label="Waive" onClick={() => setActing({ row: r, action: "waive" })} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {acting && <ActionDialog {...acting} onClose={() => setActing(null)} />}
    </>
  );
}

function IconButton({ icon: Icon, label, onClick }: { icon: typeof Eraser; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-default-200 text-[12px] font-semibold text-default-600 bg-white hover:bg-default-50 hover:text-default-950 cursor-pointer"
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function ActionDialog({ row, action, onClose }: { row: AdminStatementRow; action: Action; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = COPY[action];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await toast.promise(
        apiRequest(`/api/admin/billing/statements/${row.id}`, {
          method: "PATCH",
          body: { action, note, ...(action === "extend" ? { days } : {}) },
        }),
        { loading: "Saving…", success: "Invoice updated", error: "Not saved" },
      );
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : null);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={c.title}
      subtitle={`${formatUsd(row.amountDueUsd)} · ${invoicePeriodLabel(row)}${row.merchant ? ` · ${row.merchant.name}` : ""}`}
      onClose={onClose}
      busy={busy}
    >
      <p className="text-[13px] text-default-500 mt-3">{c.body}</p>
      {action === "extend" && (
        <div className="mt-4 space-y-1.5">
          <label className="text-[13px] font-medium text-default-700">Extra days</label>
          <input
            type="number"
            min={1}
            max={60}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] text-default-900 focus:outline-none focus:border-primary"
          />
        </div>
      )}
      <div className="mt-4 space-y-1.5">
        <label className="text-[13px] font-medium text-default-700">Note for the record</label>
        <textarea
          value={note}
          rows={3}
          maxLength={500}
          autoFocus
          onChange={(e) => setNote(e.target.value)}
          placeholder={action === "markPaid" ? "e.g. Paid 120 USDT on Tron, tx 9f2c…" : "Why"}
          className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] text-default-900 focus:outline-none focus:border-primary resize-y"
        />
      </div>
      {error && <p className="text-[13px] text-accent-red mt-3">{error}</p>}
      <ModalActions
        onCancel={onClose}
        onConfirm={() => void submit()}
        busy={busy}
        disabled={note.trim().length < 3}
        danger={c.danger}
        confirmLabel={c.cta}
      />
    </Modal>
  );
}
