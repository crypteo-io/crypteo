"use client";

import { CheckoutLayout, SummaryRow } from "@/components/checkout/CheckoutLayout";
import { CheckoutSteps } from "@/components/checkout/CheckoutSteps";
import { CountdownBar } from "@/components/checkout/CountdownBar";
import { SessionExpired } from "@/components/checkout/SessionExpired";
import { CheckoutSelectPayment } from "@/components/checkout/types";
import { getChainMeta } from "@/components/ui/ChainIcon";
import { CheckoutTooltip } from "@/components/ui/CheckoutTooltip";
import { estimateTokenAmount, formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { byWalletOrder } from "@/lib/wallet-slots";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Info, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

/** Above this many coins the picker gets a search field and compact cards. */
const SEARCH_FROM = 6;

export function CheckoutClient({
  initialPayment: payment,
  merchantName,
  merchantLogoUrl,
  onContinue,
}: {
  initialPayment: CheckoutSelectPayment;
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  /** Takes the choice instead of saving it: the public checkout demo, which never calls the API. */
  onContinue?: (choice: { chain: string; token: string }) => void;
}) {
  const router = useRouter();
  const [selectedToken, setSelectedToken] = useState("");
  const [selectedChain, setSelectedChain] = useState("");
  const [loadingSelection, setLoadingSelection] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timeInitialized, setTimeInitialized] = useState(false);
  // Pending "taking you to it" redirect after a 409, cleared on unmount so it
  // can't fire after the buyer has already navigated away.
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  useEffect(() => {
    const calculateTimeLeft = () => {
      const expiry = new Date(payment.expiresAt).getTime();
      const now = new Date().getTime();
      return Math.max(0, Math.floor((expiry - now) / 1000));
    };
    setTimeLeft(calculateTimeLeft());
    setTimeInitialized(true);
    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [payment.expiresAt]);


  const TOTAL_SECONDS = 3600;

  // Every token/network pair the merchant can receive, one card each, in the
  // Wallets page's order so one coin's networks sit together.
  const walletOptions = useMemo(
    () =>
      byWalletOrder(payment.availableWallets).map((w) => ({
        token: w.token.toLowerCase(),
        chain: w.chain.toLowerCase(),
        tokenMeta: getChainMeta(w.token),
        chainMeta: getChainMeta(w.chain),
      })),
    [payment.availableWallets],
  );
  const searchable = walletOptions.length > SEARCH_FROM;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shownOptions = needle
    ? walletOptions.filter((o) =>
        [o.token, o.chain, o.tokenMeta.name, o.chainMeta.name].some((v) => v.toLowerCase().includes(needle)),
      )
    : walletOptions;

  // Preview of the token amount from the SSR price snapshot. An estimate only:
  // the binding amount is priced server-side when the selection is saved.
  // Falls back to the USD price when no rate was preloaded.
  const rate = selectedToken
    ? payment.exchangeRates?.[selectedToken.toLowerCase()]
    : undefined;
  const hasRate = !!rate && rate > 0;
  const displayAmount = hasRate
    ? estimateTokenAmount(payment.expectedAmount, rate)
    : payment.expectedAmount;
  const displayCurrency = hasRate ? selectedToken.toUpperCase() : "USD";

  const handleProceed = async () => {
    if (!selectedToken || !selectedChain) return;
    if (onContinue) {
      onContinue({ chain: selectedChain, token: selectedToken });
      return;
    }
    setLoadingSelection(true);
    setSelectionError(null);
    try {
      const res = await fetch(`/api/payments/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: selectedChain, token: selectedToken }),
      });
      if (res.status === 409) {
        // The session can no longer be re-pointed (funds already detected,
        // no longer pending, or the merchant fixed the chain). Its existing
        // selection is the one that counts, so send the buyer to it rather
        // than leaving them on a selector that can only fail.
        // Show the server's reason (when it gave one) and always say what
        // happens next, so the automatic navigation isn't a surprise.
        const data = await res.json().catch(() => ({}));
        const reason =
          typeof data.error === "string" && data.error
            ? data.error.replace(/\.?$/, ".")
            : "This payment can no longer be changed.";
        setSelectionError(`${reason} Taking you to it…`);
        redirectTimer.current = setTimeout(
          () => router.replace(`/checkout/${payment.id}/pay`),
          1500,
        );
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error || "Failed to select network. Please try again.",
        );
      }
      router.push(`/checkout/${payment.id}/pay`);
    } catch (err: unknown) {
      setSelectionError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
      setLoadingSelection(false);
    }
  };

  const isReady = !!selectedToken && !!selectedChain;
  const isExpired = timeInitialized && timeLeft <= 0;

  const usdText = `$${formatAmount(payment.expectedAmount, "usd")}`;
  const summaryRows: SummaryRow[] = [{ label: "Order total", value: `${usdText} USD` }];
  if (hasRate) {
    summaryRows.push({
      label: "Paying with",
      value: `${selectedToken.toUpperCase()}${selectedChain ? ` · ${getChainMeta(selectedChain).name}` : ""}`,
    });
  }
  const summaryTotal: SummaryRow = {
    label: hasRate ? "You pay (est.)" : "Amount due",
    value: hasRate ? (
      <>
        {formatAmount(displayAmount, displayCurrency)}{" "}
        <span className="text-default-500">{displayCurrency}</span>
      </>
    ) : (
      `${usdText} USD`
    ),
  };
  const layoutProps = {
    merchantName,
    merchantLogoUrl,
    title: payment.paymentLink?.title,
    description: payment.paymentLink?.description,
    rows: summaryRows,
    total: summaryTotal,
    isTest: payment.isTest,
  };

  if (isExpired) {
    return (
      <CheckoutLayout {...layoutProps}>
        <SessionExpired paymentId={payment.id} />
      </CheckoutLayout>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative w-full"
    >
      <CheckoutLayout {...layoutProps}>
        <div className="mb-6 flex items-center justify-between gap-3">
          {onContinue ? (
            <div className="size-11" />
          ) : (
            <button
              onClick={() => (payment.cancelUrl ? window.location.assign(payment.cancelUrl) : router.back())}
              aria-label="Back"
              className="-ml-2 flex size-11 items-center justify-center rounded-xl text-default-600 transition-colors hover:bg-default-100 hover:text-default-900"
            >
              <ArrowLeft size={18} strokeWidth={2.5} />
            </button>
          )}
          <CheckoutSteps current="select" />
        </div>

        <h1 className="text-2xl sm:text-[28px]">Choose how to pay</h1>
        <p className="mt-1.5 text-sm text-default-600">
          Pick the coin and network your wallet will send from.
        </p>

        <CountdownBar className="mt-5" timeLeft={timeLeft} totalSeconds={TOTAL_SECONDS} label="Session expires in" />

        {searchable && (
          <div className="relative mt-6">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-default-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search coins or networks"
              aria-label="Search coins or networks"
              className="h-11 w-full rounded-xl border border-default-200 bg-white pr-3 pl-10 text-sm text-default-900 placeholder:text-default-400 focus:border-ck-ink focus:ring-4 focus:ring-ck/10 focus:outline-none"
            />
          </div>
        )}

        <div
          role="group"
          aria-label="Currency and network"
          className={cn(
            "grid grid-cols-2 gap-2.5 sm:grid-cols-3",
            searchable ? "-mx-1.5 mt-1.5 max-h-[344px] overflow-y-auto p-1.5 [scrollbar-width:thin]" : "mt-6",
          )}
        >
          {shownOptions.map((opt, i) => {
            const selected = selectedToken === opt.token && selectedChain === opt.chain;
            return (
              <motion.button
                key={`${opt.token}-${opt.chain}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.03, duration: 0.25 }}
                onClick={() => {
                  setSelectedToken(opt.token);
                  setSelectedChain(opt.chain);
                }}
                aria-pressed={selected}
                className={cn(
                  "relative flex rounded-xl border text-left transition-colors",
                  searchable ? "min-h-16 items-center gap-3 p-3" : "min-h-[104px] flex-col items-start gap-2.5 p-3.5",
                  selected
                    ? "border-ck-ink bg-white ring-4 ring-ck/10"
                    : "border-default-200 bg-white hover:border-default-300 hover:bg-default-50",
                )}
              >
                <span className="relative">
                  <Image
                    src={opt.tokenMeta.image}
                    alt=""
                    width={32}
                    height={32}
                    className="size-8 rounded-full object-contain"
                  />
                  {opt.chain !== opt.token && (
                    <Image
                      src={opt.chainMeta.image}
                      alt=""
                      width={16}
                      height={16}
                      className="absolute -right-1 -bottom-1 size-4 rounded-full bg-white object-contain ring-2 ring-white"
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-heading text-base leading-tight font-semibold text-default-950 uppercase">
                    {opt.token}
                  </span>
                  <span className="block truncate text-xs text-default-500">
                    on {opt.chainMeta.name}
                  </span>
                </span>
                {selected && (
                  <span className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full bg-ck text-on-ck">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {searchable && shownOptions.length === 0 && (
          <p className="mt-3 text-sm text-default-500">No coin or network matches &ldquo;{query.trim()}&rdquo;.</p>
        )}

        {walletOptions.length === 0 && (
          <p className="mt-6 rounded-xl border border-default-200 bg-default-50 p-4 text-sm text-default-600">
            This merchant has no payment methods available right now.
          </p>
        )}

        <div className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-default-200 bg-default-50 px-4 py-3">
          <div>
            <p className="text-xs font-medium text-default-500">
              {hasRate ? "You will send about" : "Amount due"}
            </p>
            <p className="font-heading text-xl font-semibold break-all text-default-950">
              {formatAmount(displayAmount, displayCurrency)}{" "}
              <span className="text-base text-default-500">{displayCurrency}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 pt-0.5 text-xs font-medium text-default-500">
            <CheckoutTooltip content="A small blockchain fee is required to process your transaction. Ensure your wallet covers this.">
              <Info size={14} strokeWidth={2.5} className="cursor-help" />
            </CheckoutTooltip>
            <span className="whitespace-nowrap">+ network fee</span>
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {selectionError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent-red/20 bg-accent-red/5 p-3.5 text-[13px] font-medium text-accent-red"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span className="w-full leading-relaxed wrap-break-word">
                {selectionError}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* CTA */}
        <motion.button
          onClick={handleProceed}
          disabled={!isReady || loadingSelection}
          whileTap={isReady ? { scale: 0.98 } : {}}
          className={cn(
            "mt-5 flex min-h-13 w-full items-center justify-center gap-2.5 rounded-xl text-base font-semibold transition-colors",
            isReady
              ? "cursor-pointer bg-ck text-on-ck hover:bg-ck-deep"
              : "cursor-not-allowed bg-default-100 text-default-400",
          )}
        >
          {loadingSelection ? (
            <div className="size-5 animate-spin rounded-full border-2 border-on-ck/25 border-t-on-ck" />
          ) : (
            <>
              Continue to payment
              <ArrowRight size={17} strokeWidth={2.5} />
            </>
          )}
        </motion.button>
      </CheckoutLayout>
    </motion.div>
  );
}
