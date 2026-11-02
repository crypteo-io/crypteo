"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { LocalDate } from "@/components/ui/LocalDate";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiRequest } from "@/lib/api-client";
import type { OrphanKind } from "@/lib/payment/orphan-review";
import { copyWithToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Ban, Copy, HandCoins } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KIND_LABELS } from "./OrphansClient";

interface Candidate {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: string;
  expectedAmount: number;
  receivedAmount: number | null;
  externalId: string | null;
  distance: number;
  refusal: string | null;
  outcome: { receivedAmount: number; status: string };
}

interface Data {
  orphan: {
    id: string;
    createdAt: string;
    blockTime: string | null;
    chain: string;
    token: string;
    receivedAmount: number;
    walletAddress: string;
    txHash: string;
    kind: OrphanKind;
    resolvedAt: string | null;
    resolvedToPaymentId: string | null;
    notes: string | null;
  };
  owner: { id: string; name: string } | null;
  resolvedTo: { id: string; status: string; receivedAmount: number | null; expectedAmount: number } | null;
  candidates: Candidate[];
}

const th = "px-5 py-3 text-[12px] font-medium text-default-500";
const td = "px-5 py-3 text-[13px] text-default-600";

export function OrphanReviewClient({ data }: { data: Data }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const { orphan } = data;
  const unit = orphan.token.toUpperCase();
  const kind = KIND_LABELS[orphan.kind];

  const resolve = async (body: object, messages: { loading: string; success: string }) => {
    setBusy(true);
    try {
      await toast.promise(apiRequest(`/api/admin/orphans/${orphan.id}`, { method: "POST", body }), {
        ...messages,
        error: "Not resolved",
      });
      router.refresh();
    } catch {
      // The toast explains the failure; refresh so the page shows what changed.
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const credit = async (c: Candidate) => {
    const ok = await confirm({
      title: "Credit this deposit?",
      description: (
        <div className="space-y-2">
          <p>
            Session <span className="font-mono text-[12px]">{c.id}</span> will record{" "}
            <strong>
              {c.outcome.receivedAmount} {unit}
            </strong>{" "}
            received and become <strong>{c.outcome.status.replace("_", " ")}</strong>.
          </p>
          <p>The merchant&apos;s webhook and email fire as for any payment. This can&apos;t be undone here.</p>
        </div>
      ),
      confirmLabel: "Credit session",
    });
    if (!ok) return;
    await resolve(
      { action: "credit", paymentId: c.id, seen: { status: c.status, receivedAmount: c.receivedAmount } },
      { loading: "Crediting session…", success: `Credited: session is now ${c.outcome.status.replace("_", " ")}` },
    );
  };

  const dismiss = async () => {
    if (notes.trim().length < 3) {
      toast.warning("Add a reason", "Say why this deposit is being dismissed, for the audit trail.");
      return;
    }
    const ok = await confirm({
      title: "Dismiss this deposit?",
      description: "It leaves the review queue without crediting any session. Use this for dust, address-poisoning sends, or the merchant's own transfers.",
      confirmLabel: "Dismiss",
      tone: "danger",
    });
    if (!ok) return;
    await resolve({ action: "dismiss", notes }, { loading: "Dismissing…", success: "Orphan dismissed" });
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title={
          <>
            {orphan.receivedAmount} {unit}{" "}
            <span className="text-[18px] font-medium text-default-500 uppercase">on {orphan.chain}</span>
          </>
        }
        backHref="/orphans"
        backLabel="Back to orphans"
        subtitle={
          <>
            Detected <LocalDate value={orphan.createdAt} withTime /> ·{" "}
            {data.owner ? (
              <Link href={`/merchants/${data.owner.id}`} className="font-medium text-sky hover:underline">
                {data.owner.name}
              </Link>
            ) : (
              "no merchant has this wallet registered"
            )}
          </>
        }
      />

      <section className="frame">
      <div className={cn("frame-inner h-full", "p-6 grid grid-cols-1 md:grid-cols-2 gap-6")}>
        <Field label="Kind">
          <span
            className={cn(
              "inline-flex px-2.5 py-0.5 rounded-pill text-[11px] font-semibold capitalize border",
              kind.className,
            )}
          >
            {kind.label}
          </span>
          <p className="text-[12px] text-default-500 mt-1.5">{kind.hint}</p>
        </Field>
        <Field label="Receiving wallet">
          <CopyText value={orphan.walletAddress} what="Wallet address copied" />
        </Field>
        <Field label={orphan.kind === "transaction" ? "Transaction hash" : "Reference"}>
          <CopyText value={orphan.txHash} what="Transaction reference copied" />
        </Field>
        <Field label="Block time">
          {orphan.blockTime ? <LocalDate value={orphan.blockTime} withTime /> : "Unknown"}
        </Field>
      </div>
      </section>

      {orphan.resolvedAt ? (
        <section className="frame">
        <div className={cn("frame-inner h-full", "p-6")}>
          <h2 className="text-[17px] font-heading font-semibold text-default-900">Resolved</h2>
          <p className="text-[14px] text-default-600 mt-2">
            <LocalDate value={orphan.resolvedAt} withTime /> ·{" "}
            {data.resolvedTo ? (
              <>
                credited to session <span className="font-mono text-[12px]">{data.resolvedTo.id}</span>, now{" "}
                <StatusBadge status={data.resolvedTo.status} />
              </>
            ) : (
              <>dismissed: {orphan.notes}</>
            )}
          </p>
        </div>
        </section>
      ) : (
        <>
          <section className="frame">
          <div className={cn("frame-inner h-full", "overflow-hidden")}>
            <div className="px-6 py-4 border-b border-default-200 bg-default-50">
              <h2 className="text-[15px] font-heading font-semibold text-default-900">Candidate sessions</h2>
              <p className="text-[12px] text-default-500 mt-1">
                Same wallet and token, closest amount first. Only sessions that expired more than 15
                minutes ago can be credited: until then the worker may still credit them itself.
              </p>
            </div>
            {data.candidates.length === 0 ? (
              <p className="px-6 py-8 text-[13px] text-default-500">
                No sessions on this wallet in the 30 days before the deposit. Dismiss it below if it
                isn&apos;t a customer payment.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left stack-table">
                  <thead>
                    <tr className="border-b border-default-200 bg-default-50">
                      <th className={th}>Session</th>
                      <th className={th}>Created / expires</th>
                      <th className={th}>Expected</th>
                      <th className={th}>Already received</th>
                      <th className={th}>Status</th>
                      <th className={cn(th, "text-right")}>Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default-100">
                    {data.candidates.map((c) => (
                      <tr key={c.id} className={cn(c.refusal && "opacity-60")}>
                        <td className={cn(td, "font-mono text-[12px]")}>
                          {c.id}
                          {c.externalId && (
                            <p className="font-body text-[11px] text-default-500">ref {c.externalId}</p>
                          )}
                        </td>
                        <td data-label="Created / expires" className={cn(td, "whitespace-nowrap text-[12px]")}>
                          <div>
                            <LocalDate value={c.createdAt} withTime />
                            <p className="text-default-500">
                              <LocalDate value={c.expiresAt} withTime />
                            </p>
                          </div>
                        </td>
                        <td data-label="Expected" className={cn(td, "whitespace-nowrap font-semibold text-default-900")}>
                          {c.expectedAmount} {unit}
                        </td>
                        <td data-label="Already received" className={cn(td, "whitespace-nowrap")}>{c.receivedAmount ?? "–"}</td>
                        <td data-label="Status" className={td}>
                          <StatusBadge status={c.status} />
                        </td>
                        <td data-actions className={cn(td, "text-right")}>
                          {c.refusal ? (
                            <span className="text-[12px] text-default-500">{c.refusal}</span>
                          ) : (
                            <button
                              onClick={() => credit(c)}
                              disabled={busy}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-[12px] font-semibold hover:bg-primary-deep disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            >
                              <HandCoins size={14} /> Credit → {c.outcome.status.replace("_", " ")}
                            </button>
                          )}
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
          <div className={cn("frame-inner h-full", "p-6 space-y-4")}>
            <div>
              <h2 className="text-[17px] font-heading font-semibold text-default-900">Not a customer payment?</h2>
              <p className="text-[13px] text-default-500 mt-1">
                Dust and zero-value sends from look-alike addresses (address poisoning), or the
                merchant moving their own funds, can be dismissed.
              </p>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Reason, e.g. dust from a look-alike address"
              className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky"
            />
            <div className="flex justify-end">
              <button
                onClick={dismiss}
                disabled={busy}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-accent-red/20 bg-accent-red/5 text-accent-red text-[13px] font-semibold hover:bg-accent-red hover:text-white disabled:opacity-50 cursor-pointer"
              >
                <Ban size={14} /> Dismiss
              </button>
            </div>
          </div>
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-medium text-default-700 mb-1.5">{label}</p>
      <div className="text-[14px] text-default-700">{children}</div>
    </div>
  );
}

function CopyText({ value, what }: { value: string; what: string }) {
  return (
    <button
      onClick={() => copyWithToast(value, what)}
      className="inline-flex items-start gap-2 text-left font-mono text-[12px] break-all hover:text-default-950 cursor-pointer"
    >
      {value} <Copy size={12} className="shrink-0 mt-0.5" />
    </button>
  );
}
