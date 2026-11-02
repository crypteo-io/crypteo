"use client";

import { cn } from "@/lib/utils";
import { CheckCircle, Copy } from "lucide-react";
import type { ReactNode } from "react";

/** Copy button sized for a thumb (44px tall) that flips to "Copied". */
export function CopyButton({
  copied,
  onClick,
  className,
}: {
  copied: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors",
        copied
          ? "border-accent-green/25 bg-accent-green/10 text-accent-green"
          : "border-default-200 bg-white text-default-800 hover:border-ck-ink hover:text-ck-ink",
        className,
      )}
    >
      {copied ? (
        <>
          <CheckCircle size={14} /> Copied
        </>
      ) : (
        <>
          <Copy size={14} /> Copy
        </>
      )}
    </button>
  );
}

/**
 * Labelled value in a slate box with a copy button. Values wrap rather than
 * truncate: a buyer checking an address against their wallet needs every
 * character.
 */
export function CopyField({
  label,
  badge,
  value,
  children,
  copied,
  onCopy,
  className,
}: {
  label: ReactNode;
  badge?: ReactNode;
  value: ReactNode;
  children?: ReactNode;
  copied: boolean;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold text-default-900">{label}</p>
        {badge}
      </div>
      {children}
      <div className="flex items-center gap-3 rounded-xl border border-default-200 bg-default-50 py-1.5 pr-1.5 pl-3.5">
        <div className="min-w-0 flex-1 font-mono text-[13px] leading-snug font-medium break-all text-default-900">
          {value}
        </div>
        <CopyButton copied={copied} onClick={onCopy} />
      </div>
    </div>
  );
}

const RESULT_TONES = {
  brand: "bg-ck-ink/10 text-ck-ink ring-ck-ink/5",
  green: "bg-accent-green/10 text-accent-green ring-accent-green/5",
  amber: "bg-accent-orange/10 text-accent-orange ring-accent-orange/5",
  slate: "bg-default-100 text-default-500 ring-default-100/60",
} as const;

/** Large icon in a tinted circle that heads a status screen. */
export function ResultIcon({
  tone,
  children,
}: {
  tone: keyof typeof RESULT_TONES;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto mb-5 flex size-20 items-center justify-center rounded-full ring-8",
        RESULT_TONES[tone],
      )}
    >
      {children}
    </div>
  );
}

/** Label/value rows for a status screen's details. */
export function DetailList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-default-200 rounded-xl border border-default-200 bg-default-50 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4 px-4 py-3">
          <dt className="shrink-0 text-default-500">{row.label}</dt>
          <dd className="min-w-0 text-right font-medium break-all text-default-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
