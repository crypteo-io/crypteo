"use client";

import { copyWithToast, toast } from "@/lib/toast";
import { useSupportEmail } from "@/components/checkout/CheckoutContact";
import { CheckoutLayout, SummaryRow } from "@/components/checkout/CheckoutLayout";
import { CheckoutSteps } from "@/components/checkout/CheckoutSteps";
import { CopyButton, CopyField, DetailList, ResultIcon } from "@/components/checkout/CopyField";
import { CountdownBar } from "@/components/checkout/CountdownBar";
import { buildPaymentUri } from "@/components/checkout/paymentUri";
import { SessionExpired } from "@/components/checkout/SessionExpired";
import { useReturnCountdown } from "@/components/checkout/useReturnCountdown";
import { CheckoutPayment } from "@/components/checkout/types";
import { ChainIcon, getChainMeta } from "@/components/ui/ChainIcon";
import { CheckoutTooltip } from "@/components/ui/CheckoutTooltip";
import { LocalDate } from "@/components/ui/LocalDate";
import { requiredConfirmations } from "@/lib/chains/config";
import { formatAmount } from "@/lib/format";
import { GRACE_PERIOD_MS, TOPUP_WINDOW_MS } from "@/lib/payment/windows";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Info,
  Radar,
} from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";

type StatusTone = "brand" | "amber" | "slate";

const STATUS_TONES: Record<StatusTone, { box: string; dot: string; text: string }> = {
  brand: { box: "border-ck-ink/20 bg-ck-ink/5", dot: "bg-ck-ink", text: "text-ck-ink" },
  amber: {
    box: "border-accent-orange/30 bg-accent-orange/5",
    dot: "bg-accent-orange",
    text: "text-accent-orange",
  },
  slate: { box: "border-default-200 bg-default-50", dot: "bg-default-400", text: "text-default-600" },
};

const STATUS_CONFIG: Record<string, { tone: StatusTone; label?: string }> = {
  pending: { tone: "brand", label: "Waiting for your payment" },
  confirming: { tone: "brand", label: "Payment detected, confirming" },
  underpaid: { tone: "amber", label: "Waiting for the remaining amount" },
  expired: { tone: "slate", label: "Expired" },
  expired_received: { tone: "slate", label: "Expired" },
};

// Fields whose change should re-render the page.
const WATCHED_FIELDS = [
  "status",
  "confirmations",
  "receivedAmount",
  "txHash",
] as const;

const COPY_LABELS: Record<string, string> = {
  address: "Address copied",
  amount: "Amount copied",
  tag: "Destination tag copied",
  memo: "Memo copied",
  paymentId: "Payment ID copied",
  txHash: "Transaction hash copied",
};

export function PayClient({
  initialPayment,
  merchantName,
  merchantLogoUrl,
  amountUsd,
  canChangeNetwork,
  initialNow,
  demo = false,
}: {
  initialPayment: CheckoutPayment;
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  // USD price the session was created at, when it was priced in USD.
  amountUsd?: number | null;
  // Server-evaluated: false when the merchant fixed the network (directly or
  // via a pinned payment link) or the session is past re-selection.
  canChangeNetwork: boolean;
  // The server's clock at render time (ms). The first render must not read
  // the browser clock: at the expiry boundary, or with a skewed client clock,
  // the server and hydration renders would pick different branches (expired
  // vs. live) and React would throw away the whole tree. The countdown
  // switches to the browser clock right after mount.
  initialNow: number;
  /**
   * The public checkout demo (app/checkout-demo): nothing is fetched, and the
   * simulate button plays the confirmations out in the browser.
   */
  demo?: boolean;
}) {
  const [payment, setPayment] = useState<CheckoutPayment>(initialPayment);
  const supportEmail = useSupportEmail();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [now, setNow] = useState(initialNow);
  const [qrIncludeAmount, setQrIncludeAmount] = useState(false);
  const [footerOpen, setFooterOpen] = useState(false);

  const status = payment.status;
  const isSuccess = status === "confirmed" || status === "overpaid";
  const isUnderpaid = status === "underpaid";
  const expiresAtMs = new Date(payment.expiresAt).getTime();
  const timeLeft = Math.max(0, Math.floor((expiresAtMs - now) / 1000));
  // The worker only attributes top-ups to an underpaid session until
  // expiresAt + TOPUP_WINDOW_MS (it stops selecting the session at that
  // boundary). Past it, a further deposit would land as an orphan, so the page
  // must stop asking for one and send the buyer to the merchant instead.
  const topUpDeadlineMs = expiresAtMs + TOPUP_WINDOW_MS;
  const topUpClosed = isUnderpaid && now >= topUpDeadlineMs;
  // The local countdown is a display aid, never a status. Only a session the
  // SERVER still reports as unpaid (pending/expired) may show the expired
  // screen; a confirming or underpaid session past its expiry is still live.
  const isExpired =
    status === "expired_received" ||
    status === "expired" ||
    (status === "pending" && timeLeft <= 0);
  const received = payment.receivedAmount ?? 0;
  const remaining = Math.max(0, payment.expectedAmount - received);
  // Re-selecting chain/token is only possible while nothing has been seen
  // on-chain and the merchant didn't fix the network (the PATCH 409s
  // otherwise), so only offer the way back then. Status is re-checked live
  // because polling can move the session on after the page loaded.
  const canGoBack = canChangeNetwork && status === "pending" && !(received > 0);
  const returnIn = useReturnCountdown(payment.successUrl, isSuccess);

  const meta = getChainMeta(payment.chain);
  const required = requiredConfirmations(payment.chain || "", payment.token || "");

  // Status polling. Runs until the session is terminal: success, a late
  // deposit already claimed, or past the window in which the worker could
  // still attribute one (grace for pending/expired, top-up for underpaid).
  useEffect(() => {
    if (demo || isSuccess || status === "expired_received") return;
    const pollUntil =
      status === "confirming"
        ? Infinity
        : expiresAtMs + (isUnderpaid ? TOPUP_WINDOW_MS : GRACE_PERIOD_MS);
    const interval = setInterval(async () => {
      if (Date.now() > pollUntil) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(`/api/payments/${payment.id}`);
        if (!res.ok) return;
        const data = (await res.json()) as Partial<CheckoutPayment>;
        setPayment((prev) =>
          WATCHED_FIELDS.some(
            (k) => data[k] !== undefined && data[k] !== prev[k],
          )
            ? { ...prev, ...data }
            : prev,
        );
      } catch (e) {
        console.error("Poll failed", e);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [demo, status, payment.id, isSuccess, isUnderpaid, expiresAtMs]);

  // The demo's confirmations, one a second, then confirmed.
  useEffect(() => {
    if (!demo || status !== "confirming") return;
    const timer = setInterval(() => {
      setPayment((prev) =>
        prev.confirmations + 1 >= required
          ? { ...prev, confirmations: required, status: "confirmed" }
          : { ...prev, confirmations: prev.confirmations + 1 },
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [demo, status, required]);

  // Clock for the countdown and the top-up deadline. Display only — it never
  // rewrites the payment's status. The first tick is scheduled immediately so
  // the server's render-time clock is replaced by the browser's straight after
  // hydration; it stops once the last deadline the page shows has passed.
  const clockUntil = isUnderpaid ? topUpDeadlineMs : expiresAtMs;
  useEffect(() => {
    if (isSuccess) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t > clockUntil) clearInterval(timer);
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isSuccess, clockUntil]);

  const handleCopy = useCallback(async (text: string | null | undefined, key: string) => {
    if (!text) return;
    if (await copyWithToast(text.toString(), COPY_LABELS[key] ?? "Copied")) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }, []);

  // Announce what the poll just learned. Only transitions seen on this page:
  // the status the page loaded with is already on screen.
  const lastStatus = useRef(status);
  useEffect(() => {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    if (status === "confirming") {
      toast.info("Payment detected", "Waiting for network confirmations. You can keep this page open.");
    } else if (status === "confirmed" || status === "overpaid") {
      toast.success(
        "Payment confirmed",
        demo
          ? "Simulated: nothing was paid and nobody was notified. A real payment notifies the merchant here."
          : "Thank you. The merchant has been notified.",
      );
    } else if (status === "underpaid") {
      toast.warning("Partial payment received", "Send the remaining amount shown to complete it.");
    } else if (status === "expired_received") {
      toast.info("Payment received after expiry", "The merchant will review it.");
    }
  }, [status, demo]);

  // Amount the buyer should send now: the full amount, or just the shortfall
  // once a partial deposit has landed.
  const amountDue = isUnderpaid ? remaining : payment.expectedAmount;
  const amountDueText = formatAmount(amountDue, payment.token);

  // XRP has no URI scheme wallets agree on, so its QR is always the bare
  // address and the destination tag is shown (and must be entered) separately.
  const isXrp = payment.chain?.toLowerCase() === "xrp";

  // "Address" mode is the bare address and nothing else — it's what a buyer
  // pastes into an exchange withdrawal form. "With Amount" is a chain-standard
  // payment URI (BIP21 / EIP-681 / Solana Pay).
  const qrValue =
    qrIncludeAmount && !isXrp
      ? buildPaymentUri({
          chain: payment.chain,
          token: payment.token,
          address: payment.walletAddress,
          amount: amountDue,
          solMemo: payment.solMemoString,
        })
      : payment.walletAddress || "";

  // ── Order summary (side panel on desktop, strip on mobile) ──
  const summaryRows: SummaryRow[] = [];
  if (amountUsd != null) {
    summaryRows.push({ label: "Order total", value: `$${formatAmount(amountUsd, "usd")} USD` });
  }
  summaryRows.push({ label: "Network", value: meta.name });
  if (received > 0 && !isSuccess) {
    summaryRows.push({
      label: "Received",
      value: `${formatAmount(received, payment.token)} ${payment.token?.toUpperCase() ?? ""}`,
    });
  }
  const layoutProps = {
    merchantName,
    merchantLogoUrl,
    title: payment.paymentLink?.title,
    description: payment.paymentLink?.description,
    rows: summaryRows,
    total: {
      label: "Total",
      value: (
        <>
          {formatAmount(payment.expectedAmount, payment.token)}{" "}
          <span className="text-default-500 uppercase">{payment.token}</span>
        </>
      ),
    },
    isTest: payment.isTest,
  };

  const copyField = (key: string, label: string, value: string | null | undefined) => (
    <CopyField
      label={label}
      value={value}
      copied={copiedKey === key}
      onCopy={() => handleCopy(value, key)}
    />
  );

  // ── Success state ──
  if (isSuccess) {
    return (
      <CheckoutLayout {...layoutProps}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="mx-auto w-full max-w-md py-2 text-center lg:py-6"
        >
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 220, damping: 18 }}
          >
            <ResultIcon tone="green">
              <CheckCircle size={36} strokeWidth={2.25} />
            </ResultIcon>
          </motion.div>
          <h2 className="mb-1.5 text-2xl sm:text-[28px]">Payment confirmed</h2>
          <p className="text-sm text-default-600">
            {demo ? "Simulated: no transaction was sent" : "Transaction verified on-chain"}
          </p>

          <div className="mt-7 space-y-4 text-left">
            <DetailList
              rows={[
                {
                  label: "Amount paid",
                  value: (
                    <span className="font-heading text-base font-semibold text-default-950">
                      {formatAmount(payment.receivedAmount ?? payment.expectedAmount, payment.token)}{" "}
                      <span className="text-default-500 uppercase">{payment.token}</span>
                    </span>
                  ),
                },
                { label: "Network", value: meta.name },
                ...(merchantName ? [{ label: "Paid to", value: merchantName }] : []),
              ]}
            />
            {payment.txHash && copyField("txHash", "Transaction ID", payment.txHash)}
            {payment.successUrl && (
              <>
                <a
                  href={payment.successUrl}
                  className="flex min-h-13 items-center justify-center gap-2 rounded-xl bg-ck px-8 text-base font-semibold text-on-ck transition-colors hover:bg-ck-deep"
                >
                  Return to {merchantName || "the store"}
                  <ExternalLink size={15} strokeWidth={2.5} />
                </a>
                <p className="text-center text-[13px] text-default-500" aria-live="polite">
                  Taking you back in {returnIn}s
                </p>
              </>
            )}
          </div>
        </motion.div>
      </CheckoutLayout>
    );
  }

  // ── Expired state ──
  if (isExpired) {
    return (
      <CheckoutLayout {...layoutProps}>
        <SessionExpired
          paymentId={payment.id}
          txHash={payment.txHash}
          lateReceived={status === "expired_received"}
          returnUrl={payment.cancelUrl}
        />
      </CheckoutLayout>
    );
  }

  const confirmationProgress = Math.min(payment.confirmations / required, 1);
  const statusCfg = STATUS_CONFIG[payment.status] || {
    tone: "slate",
    label: payment.status,
  };
  const tone = STATUS_TONES[statusCfg.tone];

  const simulateButton = (
    <AnimatePresence>
      {(payment.isTest || (demo && payment.status !== "confirming")) &&
        payment.status !== "confirmed" &&
        payment.status !== "expired" && (
          <motion.button
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={async () => {
              if (demo) {
                setPayment((prev) => ({
                  ...prev,
                  status: "confirming",
                  receivedAmount: prev.expectedAmount,
                  confirmations: 0,
                  txHash: `demo-transaction-${prev.id}`,
                }));
                return;
              }
              try {
                const res = await fetch(
                  `/api/payments/${payment.id}/simulate`,
                  { method: "POST" },
                );
                if (res.ok) {
                  const data = await res.json();
                  setPayment((prev) => ({ ...prev, ...data.payment }));
                }
              } catch (e) {
                console.error("Simulation failed", e);
              }
            }}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent-red/25 bg-accent-red/5 text-[13px] font-semibold text-accent-red transition-colors hover:bg-accent-red/10"
          >
            Simulate successful payment
          </motion.button>
        )}
    </AnimatePresence>
  );

  // ── Detected / confirming ──
  if (status === "confirming") {
    return (
      <CheckoutLayout {...layoutProps}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="mx-auto w-full max-w-md py-2 text-center lg:py-6"
        >
          <ResultIcon tone="brand">
            <Radar size={34} />
          </ResultIcon>
          <h2 className="mb-1.5 text-2xl sm:text-[28px]">Payment detected</h2>
          <p className="mx-auto max-w-[360px] text-sm leading-relaxed text-default-600">
            Waiting for network confirmations. You can keep this page open; it
            updates on its own.
          </p>

          <div className="mt-6 text-left">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-default-500">Confirmations</span>
              <span className="font-mono text-[13px] font-semibold text-default-900">
                {payment.confirmations}
                <span className="text-default-400">/{required}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ck-ink/10">
              <motion.div
                className="h-full rounded-full bg-ck-ink"
                initial={false}
                animate={{ width: `${Math.max(confirmationProgress, 0.04) * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
          </div>

          <div className="mt-6 space-y-4 text-left">
            <DetailList
              rows={[
                {
                  label: "Amount",
                  value: (
                    <>
                      {formatAmount(payment.expectedAmount, payment.token)}{" "}
                      <span className="text-default-500 uppercase">{payment.token}</span>
                    </>
                  ),
                },
                { label: "Network", value: meta.name },
                { label: "Status", value: <span className="text-ck-ink">{statusCfg.label}</span> },
              ]}
            />
            {copyField("paymentId", "Payment ID", payment.id)}
            {payment.txHash && copyField("txHash", "Transaction ID", payment.txHash)}
            {simulateButton}
          </div>
        </motion.div>
      </CheckoutLayout>
    );
  }

  // ── Pending / underpaid: the numbered steps ──
  const isXrpTagged = payment.chain?.toLowerCase() === "xrp" && !!payment.xrpDestinationTag;
  const isSolMemo = payment.chain?.toLowerCase() === "sol" && !!payment.solMemoString;
  const waitStep = isXrpTagged || isSolMemo ? 4 : 3;

  const qrBlock = (
    <div className="flex flex-col items-center gap-3">
      {/* QR Toggle — not for XRP, whose QR is always the bare address */}
      <div className={cn("inline-flex rounded-xl bg-default-100 p-1", isXrp && "hidden")}>
        <button
          onClick={() => setQrIncludeAmount(false)}
          className={cn(
            "min-h-11 rounded-lg px-2.5 text-xs font-semibold transition-colors",
            !qrIncludeAmount
              ? "bg-white text-default-950 shadow-sm"
              : "text-default-500 hover:text-default-800",
          )}
        >
          Address
        </button>
        <button
          onClick={() => setQrIncludeAmount(true)}
          className={cn(
            "min-h-11 rounded-lg px-2.5 text-xs font-semibold transition-colors",
            qrIncludeAmount
              ? "bg-white text-default-950 shadow-sm"
              : "text-default-500 hover:text-default-800",
          )}
        >
          With amount
        </button>
      </div>
      <div className="w-full max-w-[210px] rounded-xl border border-default-200 bg-white p-3">
        <QRCodeSVG value={qrValue} size={184} level="M" className="block h-auto w-full" />
      </div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-default-500">
        Scan with your wallet app
        <CheckoutTooltip content="Scan the QR code with your wallet app to automatically fill payment details.">
          <Info size={14} className="cursor-help text-default-400 transition-colors hover:text-default-600" />
        </CheckoutTooltip>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative w-full"
    >
      <CheckoutLayout {...layoutProps}>
        <div className="mb-6 flex items-center justify-between gap-3">
          {canGoBack ? (
            <Link
              href={`/checkout/${payment.id}?edit=true`}
              className="-ml-2 flex size-11 items-center justify-center rounded-xl text-default-600 transition-colors hover:bg-default-100 hover:text-default-900"
            >
              <ArrowLeft size={18} strokeWidth={2.5} />
            </Link>
          ) : (
            <div className="size-11" />
          )}
          <CheckoutSteps current="pay" />
        </div>

        {/* Underpaid: what arrived, and what's still owed */}
        {isUnderpaid && (
          <div className="mb-7 text-center">
            <ResultIcon tone="amber">
              <CircleAlert size={34} />
            </ResultIcon>
            <h2 className="mb-4 text-2xl">Partial payment received</h2>
            <div className="text-left">
              <DetailList
                rows={[
                  {
                    label: "Received",
                    value: (
                      <span className="font-mono">
                        {formatAmount(received, payment.token)}{" "}
                        <span className="uppercase">{payment.token}</span>
                      </span>
                    ),
                  },
                  {
                    label: "Remaining",
                    value: (
                      <span className="font-mono text-accent-orange">
                        {amountDueText}{" "}
                        <span className="uppercase">{payment.token}</span>
                      </span>
                    ),
                  },
                ]}
              />
              {topUpClosed ? (
                <p className="mt-3 rounded-xl border border-accent-orange/30 bg-accent-orange/5 px-4 py-3 text-[13px] leading-relaxed text-default-700">
                  The window to complete this payment closed on{" "}
                  <span className="font-semibold text-default-900">
                    <LocalDate value={new Date(topUpDeadlineMs)} withTime />
                  </span>
                  . Please don&apos;t send any more funds to this address:
                  they can no longer be matched to this payment. Contact the
                  merchant with your Payment ID below to settle the
                  difference.
                </p>
              ) : (
                <p className="mt-3 rounded-xl border border-accent-orange/30 bg-accent-orange/5 px-4 py-3 text-[13px] leading-relaxed text-default-700">
                  Send the remaining amount to the same address below
                  {isXrp && payment.xrpDestinationTag
                    ? ", with the same destination tag,"
                    : ""}{" "}
                  by{" "}
                  <span className="font-semibold text-default-900">
                    <LocalDate value={new Date(topUpDeadlineMs)} withTime />
                  </span>{" "}
                  to complete this payment. If you can&apos;t, contact the
                  merchant with your Payment ID.
                </p>
              )}
            </div>
          </div>
        )}

        {!isUnderpaid && (
          <>
            <h1 className="text-2xl sm:text-[28px]">Send your payment</h1>
            <p className="mt-1.5 mb-6 text-sm text-default-600">
              Follow the steps below from any wallet or exchange.
            </p>
          </>
        )}

        {/* Payment instructions — withheld once the top-up window has
            closed, since anything sent then would not be credited. */}
        {!topUpClosed && (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-7">
            <ol>
              <Step
                n={1}
                title={isUnderpaid ? "Send the remaining" : "Send exactly"}
                badge={
                  <CheckoutTooltip content="This is what the merchant must receive. Your wallet adds the network fee on top, so keep a little extra for it.">
                    <Info size={15} strokeWidth={2.5} aria-label="About the network fee" className="cursor-help text-default-500" />
                  </CheckoutTooltip>
                }
              >
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                  <span className="font-heading text-[32px] leading-none font-semibold tracking-[-0.03em] break-all text-default-950 sm:text-4xl">
                    {amountDueText}
                  </span>
                  <span className="font-heading text-lg font-semibold text-default-500 uppercase">
                    {payment.token}
                  </span>
                  <CopyButton
                    copied={copiedKey === "amount"}
                    onClick={() => handleCopy(amountDueText, "amount")}
                  />
                </div>
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-default-200 bg-white py-1 pr-3 pl-1 text-xs text-default-600">
                  <ChainIcon chain={payment.token} size={20} />
                  <span className="font-semibold text-default-900 uppercase">{payment.token}</span>
                  <span>on</span>
                  <ChainIcon chain={payment.chain} size={16} />
                  <span className="font-semibold text-default-900">{meta.name}</span>
                </div>
                <div className="mt-5 rounded-xl border border-default-200 bg-default-50 p-3 sm:p-4 lg:hidden">
                  {qrBlock}
                </div>
              </Step>

              <Step n={2} title="To this address">
                <CopyField
                  label={<span className="sr-only">Wallet address</span>}
                  value={payment.walletAddress}
                  copied={copiedKey === "address"}
                  onCopy={() => handleCopy(payment.walletAddress, "address")}
                />
              </Step>

              {/* XRP Destination Tag */}
              {isXrpTagged && (
                <Step n={3} title="Include this destination tag" badge={<NeedBadge>Required</NeedBadge>}>
                  <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-3.5">
                    <CopyField
                      label="Destination tag"
                      value={payment.xrpDestinationTag}
                      copied={copiedKey === "tag"}
                      onCopy={() => handleCopy(payment.xrpDestinationTag, "tag")}
                    >
                      <p className="mb-2.5 text-[13px] leading-relaxed font-medium text-default-700">
                        The QR code contains only the address. Enter this tag in
                        your wallet so the payment is matched to your order.
                      </p>
                    </CopyField>
                  </div>
                </Step>
              )}

              {/* Solana Memo */}
              {isSolMemo && (
                <Step n={3} title="Include this memo" badge={<NeedBadge>Recommended</NeedBadge>}>
                  <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-3.5">
                    <CopyField
                      label="Transaction memo"
                      value={payment.solMemoString}
                      copied={copiedKey === "memo"}
                      onCopy={() => handleCopy(payment.solMemoString, "memo")}
                    />
                    <p className="mt-2 text-[13px] leading-relaxed font-medium text-default-700">
                      Include this memo in your transaction for faster processing.
                    </p>
                  </div>
                </Step>
              )}

              <Step n={waitStep} title="Wait for confirmation" last>
                <div className={cn("rounded-xl border px-4 py-3", tone.box)}>
                  <div className="flex items-center gap-2.5">
                    <span className="relative flex size-2.5 shrink-0">
                      <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", tone.dot)} />
                      <span className={cn("relative inline-flex size-2.5 rounded-full", tone.dot)} />
                    </span>
                    <span className={cn("text-sm font-semibold", tone.text)}>
                      {statusCfg.label || payment.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed font-normal text-default-500">
                    This page updates by itself once the transaction reaches the
                    network ({required} confirmation{required === 1 ? "" : "s"} needed).
                  </p>
                  {status === "pending" && (
                    <CountdownBar className="mt-3" timeLeft={timeLeft} />
                  )}
                </div>
              </Step>
            </ol>

            <div className="hidden lg:block">
              <div className="sticky top-6 w-[244px] rounded-xl border border-default-200 bg-default-50 p-4">
                {qrBlock}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-4 border-t border-default-200 pt-6">
          {copyField("paymentId", "Payment ID", payment.id)}
          {payment.txHash && copyField("txHash", "Transaction ID", payment.txHash)}
          {simulateButton}

          {/* Collapsible notice list */}
          <div className="panel-soft overflow-hidden">
            <button
              onClick={() => setFooterOpen(!footerOpen)}
              className="flex min-h-12 w-full cursor-pointer items-center justify-between px-4 transition-colors hover:bg-white/60"
            >
              <span className="text-sm font-semibold text-default-800">
                Before you send
              </span>
              <ChevronDown
                size={16}
                strokeWidth={2.5}
                className={cn(
                  "text-default-400 transition-transform duration-200",
                  footerOpen && "rotate-180",
                )}
              />
            </button>
            <AnimatePresence initial={false}>
              {footerOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <ul className="list-disc space-y-2 pr-4 pb-4 pl-9 text-[13px] leading-relaxed font-normal text-default-600">
                    <li>
                      This address takes{" "}
                      <span className="font-semibold text-default-900 uppercase">{payment.token}</span> on the{" "}
                      <span className="font-semibold text-default-900">{meta.name}</span> network only. Coins sent on
                      another network can&apos;t be recovered.
                    </li>
                    <li>Send the full amount shown. The network fee is paid on top, from your wallet.</li>
                    <li>Most payments show up within a few minutes, and this page moves on by itself.</li>
                    <li>
                      Something wrong? Write to{" "}
                      <a href={`mailto:${supportEmail}`} className="font-semibold text-ck-ink">
                        {supportEmail}
                      </a>{" "}
                      and include your Payment ID.
                    </li>
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </CheckoutLayout>
    </motion.div>
  );
}

/** One numbered step, joined to the next by a vertical rail. */
function Step({
  n,
  title,
  badge,
  last = false,
  children,
}: {
  n: number;
  title: string;
  badge?: React.ReactNode;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ck font-heading text-sm font-semibold text-on-ck">
          {n}
        </span>
        {!last && <span className="mt-2 w-px flex-1 bg-default-200" />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-1" : "pb-7")}>
        <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {badge}
        </div>
        {children}
      </div>
    </li>
  );
}

function NeedBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-accent-orange px-2 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-white uppercase">
      {children}
    </span>
  );
}
