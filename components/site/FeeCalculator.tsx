"use client";

import { formatUsd, monthlyFee, type FeeSchedule } from "@/lib/billing/fee-schedule";
import { ASSUMED_ORDER_USD, CHECKED_ON, COMPETITORS, competitorMonthlyFee, competitorRate } from "@/lib/content/competitor-fees";
import { solutionLink } from "@/lib/content/solution-links";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useId, useState } from "react";
import { LogoMark } from "./Logo";

// Volumes the slider stops at: fine steps where most merchants are, wide ones above.
const STOPS = [
  500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 75_000, 100_000, 150_000,
  250_000, 500_000, 1_000_000,
];
const DEFAULT_VOLUME = 2000;

const money = (usd: number) => formatUsd(usd >= 100 ? Math.round(usd) : usd);

/** Monthly volume slider: hosted Crypteo's fee from the billed schedule against other gateways' published rates. */
export function FeeCalculator({ schedule }: { schedule: Pick<FeeSchedule, "tiers" | "monthlyCapUsd"> }) {
  const [stop, setStop] = useState(STOPS.indexOf(DEFAULT_VOLUME));
  const id = useId();
  const volume = STOPS[stop] ?? DEFAULT_VOLUME;
  const ours = monthlyFee(schedule, volume);
  const rows = COMPETITORS.map((c) => ({ name: c.name, rate: competitorRate(c, volume), fee: competitorMonthlyFee(c, volume) }));
  const highest = Math.max(ours.feeUsd, ...rows.map((r) => r.fee), 1);
  const progress = (stop / (STOPS.length - 1)) * 100;

  return (
    <div className="frame">
      <div className="frame-inner grid overflow-hidden lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="relative isolate overflow-hidden bg-primary p-6 text-white md:p-8">
          <div aria-hidden className="absolute -top-32 -right-24 -z-10 size-80 rounded-full bg-sky/50 blur-3xl" />
          <label htmlFor={id} className="text-sm font-medium text-white/75">
            Your monthly crypto volume
          </label>
          <p className="mt-2 font-heading text-[44px] font-semibold leading-none md:text-[52px]">{formatUsd(volume)}</p>
          <input
            id={id}
            type="range"
            min={0}
            max={STOPS.length - 1}
            step={1}
            value={stop}
            onChange={(e) => setStop(Number(e.target.value))}
            aria-valuetext={`${formatUsd(volume)} a month`}
            style={{ background: `linear-gradient(to right, #5aa9f5 ${progress}%, rgb(255 255 255 / 0.2) ${progress}%)` }}
            className="mt-7 h-2 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-sky-soft [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-sky-soft [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
          />
          <div className="mt-2 flex justify-between text-xs font-normal text-white/60">
            <span>{formatUsd(STOPS[0])}</span>
            <span>{formatUsd(STOPS[STOPS.length - 1])}+</span>
          </div>

          <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-white/80">
              <LogoMark className="size-4" /> Hosted Crypteo, {ours.ratePercent}% this month
            </p>
            <p className="mt-1 font-heading text-[34px] font-semibold leading-tight" aria-live="polite">
              {money(ours.feeUsd)}
              <span className="text-base font-normal text-white/60"> / month</span>
            </p>
          </div>
          <p className="mt-4 text-sm font-normal text-white/75">
            Self-hosted: <span className="font-semibold text-white">$0</span> platform fee.{" "}
            <Link href={solutionLink("openSource").path} className="underline underline-offset-2 hover:text-white">
              How it works
            </Link>
          </p>
        </div>

        <div className="p-6 md:p-8">
          <p className="mb-5 font-heading text-lg font-semibold text-default-950">What the same month costs elsewhere</p>
          <ul className="space-y-5">
            <Bar name="Crypteo" rate={`${ours.ratePercent}%`} fee={ours.feeUsd} highest={highest} ours />
            {rows.map((r) => (
              <Bar key={r.name} name={r.name} rate={r.rate} fee={r.fee} highest={highest} saving={r.fee - ours.feeUsd} />
            ))}
          </ul>
          <p className="mt-6 text-xs font-normal leading-relaxed text-default-500">
            Other gateways&apos; rates as published, {CHECKED_ON}. BitPay&apos;s rate falls at higher volume, and its
            25¢ per payment assumes {formatUsd(ASSUMED_ORDER_USD)} orders. Coinbase Business accepts stablecoins
            only. Network fees and conversion costs aren&apos;t included.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bar({
  name,
  rate,
  fee,
  highest,
  saving,
  ours = false,
}: {
  name: string;
  rate: string;
  fee: number;
  highest: number;
  saving?: number;
  ours?: boolean;
}) {
  return (
    <li>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={cn("font-medium", ours ? "text-sky" : "text-default-950")}>
          {name} <span className="text-sm font-normal text-default-500">{rate}</span>
        </span>
        <span className={cn("font-heading font-semibold", ours ? "text-sky" : "text-default-950")}>
          {money(fee)}
          {saving != null && saving > 0 && (
            <span className="ml-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
              save {money(saving)}
            </span>
          )}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-default-100">
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", ours ? "bg-sky" : "bg-default-400")}
          style={{ width: `${Math.max(2, (fee / highest) * 100)}%` }}
        />
      </div>
    </li>
  );
}
