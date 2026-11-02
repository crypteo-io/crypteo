"use client";

import { copyWithToast } from "@/lib/toast";
import { useSupportEmail } from "@/components/checkout/CheckoutContact";
import { CheckoutSteps } from "@/components/checkout/CheckoutSteps";
import { CopyField, ResultIcon } from "@/components/checkout/CopyField";
import { motion } from "framer-motion";
import { Inbox, Mail, TimerOff } from "lucide-react";
import { useCallback, useState } from "react";

interface SessionExpiredProps {
  paymentId: string;
  txHash?: string | null;
  /**
   * The session expired but a deposit was still attributed to it
   * (expired_received). "Time's up — we can no longer process" would tell a
   * buyer who has already paid that their money is gone.
   */
  lateReceived?: boolean;
  /** The merchant's page to go back to (the payment's cancelUrl). */
  returnUrl?: string | null;
}

export function SessionExpired({
  paymentId,
  txHash,
  lateReceived = false,
  returnUrl,
}: SessionExpiredProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const supportEmail = useSupportEmail();

  const handleCopy = useCallback(async (text?: string | null, key?: string) => {
    if (!text) return;
    const copied = await copyWithToast(
      text,
      key === "txHash" ? "Transaction hash copied" : key === "id" ? "Payment ID copied" : "Copied",
    );
    if (copied && key) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="mx-auto w-full max-w-md py-2 text-center lg:py-6"
    >
      <div className="mb-8 flex justify-center">
        <CheckoutSteps current="expired" />
      </div>

      <ResultIcon tone={lateReceived ? "brand" : "slate"}>
        {lateReceived ? <Inbox size={34} /> : <TimerOff size={34} />}
      </ResultIcon>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="mb-2 text-2xl sm:text-[28px]"
      >
        {lateReceived ? "Payment received late" : <>Time&apos;s up!</>}
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32 }}
        className="mx-auto max-w-[360px] text-sm leading-relaxed text-default-600"
      >
        {lateReceived
          ? "Your payment arrived after this session expired. The merchant has been notified and will follow up to complete or refund it."
          : "The payment session has expired. We can no longer process the transaction at the quoted rate."}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.38 }}
        className="mt-7 space-y-4 text-left"
      >
        <CopyField
          label="Payment ID"
          value={paymentId}
          copied={copiedKey === "id"}
          onCopy={() => handleCopy(paymentId, "id")}
        />
        {txHash && (
          <CopyField
            label="Transaction ID"
            value={txHash}
            copied={copiedKey === "txHash"}
            onCopy={() => handleCopy(txHash, "txHash")}
          />
        )}

        <div className="rounded-xl border border-default-200 bg-default-50 px-4 py-3.5 text-center">
          <p className="text-[13px] leading-relaxed font-medium text-default-700">
            If you have already sent the deposit for this transaction, please
            contact us and provide the transaction hash.
          </p>
          <a
            href={`mailto:${supportEmail}`}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ck-ink hover:underline"
          >
            <Mail size={15} aria-hidden="true" />
            {supportEmail}
          </a>
        </div>
        {returnUrl && (
          <a
            href={returnUrl}
            className="flex min-h-13 items-center justify-center rounded-xl bg-ck px-8 text-base font-semibold text-on-ck transition-colors hover:bg-ck-deep"
          >
            Return to the store
          </a>
        )}
      </motion.div>
    </motion.div>
  );
}
