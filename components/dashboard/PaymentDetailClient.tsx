"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { copyWithToast, errorMessage, toast } from "@/lib/toast";
import { LocalDate } from "@/components/ui/LocalDate";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/format";
import { EmailLog, Payment, WebhookLog } from "@/types/payment";

// Payload and response body are deliberately not sent to the client (see
// app/dashboard/payments/[id]/page.tsx).
type WebhookLogSummary = Omit<WebhookLog, "payload" | "response">;
import gsap from "gsap";
import {
  CheckCircle,
  Copy,
  CreditCard,
  ExternalLink,
  Globe,
  Hash,
  Mail,
  RefreshCw,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useLayoutEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { PageHeader } from "./PageHeader";
import { ChainIcon } from "@/components/ui/ChainIcon";

interface DetailField {
  label: string;
  value: string | number;
  // Rendered instead of `value` when set (e.g. a locale-dependent date);
  // `value` stays the plain text that Copy puts on the clipboard.
  display?: React.ReactNode;
  mono?: boolean;
  copyable?: boolean;
  highlight?: boolean;
  uppercase?: boolean;
  truncate?: boolean;
}

interface DetailGroup {
  title: string;
  icon: React.ReactNode;
  fields: DetailField[];
}

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function PaymentDetailClient({
  payment,
  webhookLogs,
  webhookUrl,
  emailLogs,
}: {
  payment: Payment;
  webhookLogs: WebhookLogSummary[];
  /** Where this payment's webhooks go (lib/payment/notify.ts webhookTarget). */
  webhookUrl: string | null;
  emailLogs: EmailLog[];
}) {
  const router = useRouter();
  const [resending, setResending] = useState(false);

  // Sends the current event to every target now; the automatic retry
  // schedule is left as it is (see app/api/webhooks/[paymentId]).
  const handleResend = async () => {
    setResending(true);
    try {
      const res = await toast.promise(
        apiRequest<{ success: boolean; statusCode: number | null; url: string }>(
          `/api/webhooks/${payment.id}`,
          { method: "POST", body: { paymentId: payment.id } },
        ),
        {
          loading: "Sending webhook…",
          success: (r) => (r.success ? "Webhook delivered" : "Webhook not accepted"),
          description: (r) =>
            r.success
              ? hostOf(r.url)
              : `${hostOf(r.url)} answered ${r.statusCode ? `HTTP ${r.statusCode}` : "nothing"}. It must answer 2xx.`,
        },
      );
      if (res) router.refresh();
    } catch {
      // toast.promise already showed the error
    } finally {
      setResending(false);
    }
  };
  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);
  const confirm = useConfirm();
  const [markError, setMarkError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const markAsPaid = async () => {
    const ok = await confirm({
      title: "Accept as paid?",
      description: `The session is settled as confirmed with the ${payment.receivedAmount ?? 0} ${(payment.token ?? "").toUpperCase()} actually received. Your webhook and email fire as for a completed payment. This can't be undone.`,
      confirmLabel: "Mark as paid",
    });
    if (!ok) return;
    setMarking(true);
    setMarkError(null);
    try {
      await toast.promise(
        apiRequest(`/api/payments/${payment.id}/mark-paid`, { method: "POST" }),
        { loading: "Marking as paid…", success: "Payment marked as paid", error: "Not marked as paid" },
      );
      router.refresh();
    } catch (err) {
      setMarkError(errorMessage(err, "Failed to mark as paid."));
    } finally {
      setMarking(false);
    }
  };

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".animate-up", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: "power2.out",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const copy = async (text: string) => {
    if (await copyWithToast(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Both statuses hold real funds short of completing the session and can be
  // accepted at the amount actually received.
  const canMarkPaid =
    payment.status === "underpaid" || payment.status === "expired_received";

  const detailGroups: DetailGroup[] = [
    {
      title: "Transaction",
      icon: <Hash size={16} />,
      fields: [
        { label: "Payment ID", value: payment.id, mono: true, copyable: true },
        { label: "External ID", value: payment.externalId || "–", mono: true },
        {
          label: "TX Hash",
          value: payment.txHash || "Pending detection...",
          mono: true,
          copyable: !!payment.txHash,
        },
        { label: "Confirmations", value: `${payment.confirmations} blocks` },
        ...(payment.xrpDestinationTag
          ? [
              {
                label: "XRP Destination Tag",
                value: payment.xrpDestinationTag,
                mono: true,
                copyable: true,
              },
            ]
          : []),
      ],
    },
    {
      title: "Amount and asset",
      icon: <CreditCard size={16} />,
      fields: [
        {
          label: "Chain / Asset",
          value: `${(payment.chain || "unknown").toLowerCase()} / ${(payment.token || "unknown").toLowerCase()}`,
          highlight: true,
        },
        {
          label: "Expected",
          value: `${formatAmount(payment.expectedAmount, payment.token)} ${payment.token || ""}`,
          mono: true,
        },
        {
          label: "Received",
          value: payment.receivedAmount
            ? `${formatAmount(payment.receivedAmount, payment.token)} ${payment.token || ""}`
            : "Not received yet",
          mono: true,
        },
        { label: "Poll Phase", value: payment.pollPhase, uppercase: true },
      ],
    },
    {
      title: "Customer and delivery",
      icon: <User size={16} />,
      fields: [
        {
          label: "Customer Email",
          value: payment.customerEmail || "No email provided",
        },
        {
          label: "Webhook URL",
          value: webhookUrl || "No webhook endpoint",
          truncate: true,
        },
        {
          label: "Created",
          value: new Date(payment.createdAt).toISOString(),
          display: <LocalDate value={payment.createdAt} withTime />,
        },
        {
          label: "Expires",
          value: new Date(payment.expiresAt).toISOString(),
          display: <LocalDate value={payment.expiresAt} withTime />,
        },
      ],
    },
  ];

  const received = (payment.receivedAmount ?? 0) > 0;
  const detected = !!payment.txHash || received;
  const settledStatuses = ["confirmed", "overpaid", "underpaid", "expired_received"];
  const settled = settledStatuses.includes(payment.status);
  const outcome: Record<string, { label: string; detail: React.ReactNode; tone: TimelineTone }> = {
    confirmed: { label: "Confirmed", detail: "Required confirmations reached", tone: "done" },
    overpaid: { label: "Overpaid", detail: "More than the expected amount arrived", tone: "done" },
    underpaid: { label: "Underpaid", detail: "Less than the expected amount arrived", tone: "warn" },
    expired_received: { label: "Late payment", detail: "Funds arrived after the session expired", tone: "warn" },
    expired: {
      label: "Expired",
      detail: <LocalDate value={payment.expiresAt} withTime />,
      tone: "muted",
    },
  };

  const timeline: TimelineStep[] = [
    {
      title: "Session created",
      detail: <LocalDate value={payment.createdAt} withTime />,
      tone: "done",
    },
    {
      title: detected ? "Transfer detected" : "Waiting for the buyer's transfer",
      detail: detected
        ? payment.receivedAmount
          ? `${formatAmount(payment.receivedAmount, payment.token)} ${(payment.token ?? "").toUpperCase()} seen on chain`
          : "Seen on chain"
        : payment.status === "expired"
          ? "Nothing arrived before expiry"
          : "Watching the wallet address",
      tone: detected ? "done" : payment.status === "pending" ? "current" : "muted",
    },
    {
      title: "Confirmations",
      detail: `${payment.confirmations} block${payment.confirmations === 1 ? "" : "s"}`,
      tone: settled ? "done" : payment.status === "confirming" ? "current" : "muted",
    },
    outcome[payment.status]
      ? {
          title: outcome[payment.status].label,
          detail: outcome[payment.status].detail,
          tone: outcome[payment.status].tone,
        }
      : {
          title: "Settles or expires",
          detail: (
            <>
              Expires <LocalDate value={payment.expiresAt} withTime />
            </>
          ),
          tone: "muted",
        },
    {
      title: payment.webhookSentAt ? "Webhook delivered" : "Webhook",
      detail: payment.webhookSentAt ? (
        <LocalDate value={payment.webhookSentAt} withTime />
      ) : webhookUrl ? (
        "Not delivered yet"
      ) : (
        "No webhook endpoint for this payment"
      ),
      tone: payment.webhookSentAt ? "done" : "muted",
    },
  ];

  return (
    <div ref={containerRef} className="space-y-6 pb-20">
      <div className="animate-up">
        <PageHeader
          title="Payment"
          badge={<StatusBadge status={payment.status} />}
          subtitle={<span className="break-all font-mono text-[13px]">{payment.id}</span>}
          backHref="/dashboard/payments"
          backLabel="Back to payments"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* LEFT: summary + timeline */}
        <div className="space-y-6">
          <section className="frame animate-up">
          <div className="frame-inner h-full p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-xl border border-default-200 bg-default-50">
                <ChainIcon chain={payment.token || payment.chain} size={28} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] text-default-500">
                  {payment.paymentLink?.title ?? "Payment session"}
                </p>
                <ChainIcon chain={payment.chain} size={14} showName />
              </div>
            </div>

            <p className="mt-5 text-[12px] font-medium text-default-500">Expected</p>
            <p className="font-heading text-[32px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-default-950 break-all">
              {formatAmount(payment.expectedAmount, payment.token)}{" "}
              <span className="text-[18px] font-medium uppercase text-default-500">{payment.token}</span>
            </p>
            <p className="mt-1 text-[13px] text-default-600">
              Received:{" "}
              <span className="font-semibold tabular-nums text-default-900">
                {payment.receivedAmount
                  ? `${formatAmount(payment.receivedAmount, payment.token)} ${(payment.token ?? "").toUpperCase()}`
                  : "nothing yet"}
              </span>
            </p>

            <div className="mt-5 flex flex-col gap-2">
              {canMarkPaid && (
                <ActionButton
                  onClick={markAsPaid}
                  disabled={marking}
                  variant="primary"
                  className="w-full py-2.5"
                >
                  {marking ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <CheckCircle size={16} /> Mark as paid
                    </>
                  )}
                </ActionButton>
              )}
              <ActionButton
                onClick={() => window.open(`/checkout/${payment.id}`, "_blank")}
                variant={canMarkPaid ? "secondary" : "primary"}
                className="w-full py-2.5"
              >
                <ExternalLink size={16} /> View checkout
              </ActionButton>
            </div>

            {markError && (
              <div className="mt-4 rounded-xl border border-accent-red/15 bg-accent-red/5 px-4 py-3 text-[13px] font-semibold text-accent-red">
                {markError}
              </div>
            )}

            {canMarkPaid && (
              <p className="mt-4 rounded-xl border border-accent-orange/15 bg-accent-orange/5 px-4 py-3 text-[12.5px] leading-relaxed text-default-700">
                This payment received{" "}
                <span className="font-semibold text-default-900">
                  {formatAmount(payment.receivedAmount ?? 0, payment.token)}{" "}
                  {payment.token || ""}
                </span>{" "}
                of the expected {formatAmount(payment.expectedAmount, payment.token)}{" "}
                {payment.token || ""}. Marking
                it as paid confirms the session and credits the amount actually
                received. This is final: any later deposit to this wallet will be
                recorded as an orphan transaction for manual review, not added to this
                payment.
              </p>
            )}
          </div>
          </section>

          <section className="frame animate-up">
          <div className="frame-inner h-full p-5 sm:p-6">
            <h2 className="font-heading text-[16px] font-semibold text-default-950">Timeline</h2>
            <ol className="mt-4">
              {timeline.map((step, i) => (
                <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < timeline.length - 1 && (
                    <span aria-hidden className="absolute left-[11px] top-6 bottom-0 w-px bg-default-200" />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-white",
                      TONE_RING[step.tone],
                    )}
                  >
                    <span className={cn("size-2 rounded-full", TONE_DOT[step.tone])} />
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-[14px] font-semibold",
                        step.tone === "muted" ? "text-default-500" : "text-default-950",
                      )}
                    >
                      {step.title}
                    </p>
                    <p className="text-[12.5px] text-default-500">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          </section>
        </div>

        {/* RIGHT: technical details + delivery logs */}
        <div className="min-w-0 space-y-6">
          <section className="animate-up frame">
            <div className="frame-inner divide-y divide-default-100">
              {detailGroups.map((group) => (
                <div key={group.title} className="p-5 sm:p-6">
                  <h2 className="mb-3 flex items-center gap-2 font-heading text-[15px] font-semibold text-default-950">
                    <span className="text-sky">{group.icon}</span>
                    {group.title}
                  </h2>
                  <dl className="space-y-2.5">
                    {group.fields.map((field) => (
                      <div
                        key={field.label}
                        className="grid grid-cols-1 gap-0.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4"
                      >
                        <dt className="text-[13px] text-default-500">{field.label}</dt>
                        <dd className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "min-w-0 text-[13.5px] font-medium text-default-800",
                              field.truncate ? "truncate" : "break-all",
                              field.mono && "font-mono text-[12.5px]",
                              field.highlight && "font-semibold text-sky",
                              field.uppercase && "uppercase tracking-wide text-[12px] font-semibold",
                            )}
                          >
                            {field.display ?? field.value}
                          </span>
                          {field.copyable && (
                            <button
                              onClick={() => copy(String(field.value))}
                              aria-label={`Copy ${field.label}`}
                              className="shrink-0 rounded-md p-1 text-default-400 transition-colors hover:bg-default-100 hover:text-sky cursor-pointer"
                            >
                              {copied ? (
                                <CheckCircle size={14} className="text-accent-green" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {/* WEBHOOK LOGS */}
            <section className="frame animate-up">
            <div className="frame-inner h-full">
              <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
                <h2 className="flex items-center gap-2 font-heading text-[15px] font-semibold text-default-950">
                  <Globe size={16} className="text-sky" /> Webhook deliveries
                </h2>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-default-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-default-600">
                    {webhookLogs.length}
                  </span>
                  {webhookUrl && !payment.isTest && (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resending}
                      className="flex items-center gap-1.5 rounded-lg border border-default-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-default-700 transition-colors hover:bg-default-50 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw size={13} className={resending ? "animate-spin" : ""} />
                      Resend
                    </button>
                  )}
                </div>
              </div>
              {webhookLogs.length === 0 ? (
                <p className="px-5 pb-6 pt-2 text-[13px] text-default-500">
                  No webhooks have been dispatched yet.
                </p>
              ) : (
                <ul className="space-y-1 px-2.5 pb-3">
                  {webhookLogs.map((log: WebhookLogSummary) => (
                    <li key={log.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
                      <span
                        className={cn(
                          "flex h-8 min-w-11 items-center justify-center rounded-lg border px-1.5 font-mono text-[12px] font-semibold",
                          log.success
                            ? "border-accent-green/15 bg-accent-green/5 text-accent-green"
                            : "border-accent-red/15 bg-accent-red/5 text-accent-red",
                        )}
                      >
                        {log.statusCode || "ERR"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-default-900">
                          Attempt #{log.attempt}{" "}
                          <span className={log.success ? "text-accent-green" : "text-accent-red"}>
                            · {log.success ? "Delivered" : "Failed"}
                          </span>
                        </p>
                        <p className="text-[12px] text-default-500">
                          <LocalDate value={log.createdAt} withTime />
                          {log.url && log.url !== webhookUrl ? (
                            <span className="ml-2 font-mono">{hostOf(log.url)}</span>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </section>

            {/* EMAIL LOGS */}
            <section className="frame animate-up">
            <div className="frame-inner h-full">
              <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
                <h2 className="flex items-center gap-2 font-heading text-[15px] font-semibold text-default-950">
                  <Mail size={16} className="text-sky" /> Emails
                </h2>
                <span className="rounded-md bg-default-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-default-600">
                  {emailLogs.length}
                </span>
              </div>
              {emailLogs.length === 0 ? (
                <p className="px-5 pb-6 pt-2 text-[13px] text-default-500">
                  No email notifications have been triggered yet.
                </p>
              ) : (
                <ul className="space-y-1 px-2.5 pb-3">
                  {emailLogs.map((log: EmailLog) => (
                    <li key={log.id} className="rounded-xl px-2.5 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-[13px] font-semibold text-default-900">{log.subject}</p>
                        <span
                          className={cn(
                            "shrink-0 rounded-pill border px-2 py-0.5 text-[11px] font-semibold",
                            log.sentAt
                              ? "border-accent-green/15 bg-accent-green/5 text-accent-green"
                              : "border-accent-red/15 bg-accent-red/5 text-accent-red",
                          )}
                        >
                          {log.sentAt ? "Sent" : "Failed"}
                        </span>
                      </div>
                      <p className="mt-0.5 flex items-center justify-between gap-3 text-[12px] text-default-500">
                        <span className="flex min-w-0 items-center gap-1 truncate">
                          <User size={12} className="shrink-0 text-default-400" />
                          {log.recipient}
                        </span>
                        <LocalDate value={log.createdAt} />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

type TimelineTone = "done" | "current" | "warn" | "muted";

interface TimelineStep {
  title: string;
  detail: React.ReactNode;
  tone: TimelineTone;
}

const TONE_RING: Record<TimelineTone, string> = {
  done: "border-accent-green/40",
  current: "border-sky/50",
  warn: "border-accent-orange/50",
  muted: "border-default-200",
};

const TONE_DOT: Record<TimelineTone, string> = {
  done: "bg-accent-green",
  current: "bg-sky animate-pulse",
  warn: "bg-accent-orange",
  muted: "bg-default-300",
};
