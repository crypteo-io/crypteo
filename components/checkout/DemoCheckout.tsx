"use client";

import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { CheckoutColumn } from "@/components/checkout/CheckoutShell";
import { PayClient } from "@/components/checkout/PayClient";
import { checkoutPaletteStyle, type CheckoutBranding } from "@/lib/branding";
import { DEMO_RATES, DEMO_SOL_MEMO, DEMO_WALLETS } from "@/lib/checkout-demo";
import { estimateTokenAmount } from "@/lib/format";
import Image from "next/image";
import { useState } from "react";

const SESSION_MS = 60 * 60 * 1000;
const DEMO_ID = "demo_session";

type Stage = { step: "select" } | { step: "pay"; paidFrom: number; chain: string; token: string };

/**
 * The real checkout screens on sample data, never calling the API: the public
 * demo and the merchant's branding preview. Remount (a new `key`) to restart.
 */
export function DemoCheckout({
  branding,
  title,
  description,
  amountUsd,
}: {
  branding: CheckoutBranding;
  title: string;
  description: string;
  amountUsd: number;
}) {
  const [startedAt] = useState(Date.now);
  const [stage, setStage] = useState<Stage>({ step: "select" });
  const expiresAt = new Date(startedAt + SESSION_MS).toISOString();
  const paymentLink = title.trim() ? { title: title.trim(), description: description.trim() || null } : null;
  const shared = { merchantName: branding.name, merchantLogoUrl: branding.logoUrl };

  return (
    <div className="min-w-0">
      <div
        className="relative isolate overflow-hidden rounded-3xl border border-default-200 px-3 py-6 sm:px-6 sm:py-10"
        style={checkoutPaletteStyle(branding.color)}
      >
        <div aria-hidden className="absolute inset-0 -z-10">
          <Image src="/bg/section-bg-2.webp" alt="" fill sizes="(min-width: 1280px) 1040px, 100vw" className="object-cover object-top opacity-80" />
          <div className="absolute inset-0 bg-linear-to-b from-white/30 via-white/75 to-white" />
        </div>
        <CheckoutColumn branding={branding}>
          {stage.step === "select" ? (
            <CheckoutClient
              initialPayment={{
                id: DEMO_ID,
                expectedAmount: amountUsd,
                expiresAt,
                paymentLink,
                availableWallets: DEMO_WALLETS,
                exchangeRates: DEMO_RATES,
              }}
              {...shared}
              onContinue={({ chain, token }) => setStage({ step: "pay", paidFrom: Date.now(), chain, token })}
            />
          ) : (
            <PayClient
              key={`${stage.chain}-${stage.token}-${amountUsd}`}
              demo
              initialNow={stage.paidFrom}
              initialPayment={{
                id: DEMO_ID,
                status: "pending",
                chain: stage.chain,
                token: stage.token,
                walletAddress: DEMO_WALLETS.find((w) => w.chain === stage.chain && w.token === stage.token)?.address ?? null,
                expectedAmount: estimateTokenAmount(amountUsd, DEMO_RATES[stage.token] ?? 1),
                receivedAmount: null,
                confirmations: 0,
                txHash: null,
                solMemoString: stage.chain === "sol" ? DEMO_SOL_MEMO : null,
                expiresAt,
                paymentLink,
              }}
              {...shared}
              amountUsd={amountUsd}
              canChangeNetwork={false}
            />
          )}
        </CheckoutColumn>
      </div>
      <p className="mt-4 text-center text-[13px] text-default-500">
        Sample prices and deliberately invalid addresses, so no wallet will send to them. Use &ldquo;Simulate successful
        payment&rdquo; to watch it confirm.
      </p>
    </div>
  );
}
