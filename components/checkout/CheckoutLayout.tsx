import { TestModeBadge } from "@/components/checkout/CheckoutSteps";
import { MerchantLogo } from "@/components/checkout/MerchantLogo";
import { Logo } from "@/components/site/Logo";
import type { ReactNode } from "react";

export interface SummaryRow {
  label: string;
  value: ReactNode;
}

/**
 * The checkout's two-panel card. The order summary sits in a slate side panel
 * on desktop and folds into a compact strip above the steps on a phone, where
 * the steps are what the buyer needs first.
 */
export function CheckoutLayout({
  merchantName,
  merchantLogoUrl,
  title,
  description,
  rows,
  total,
  isTest,
  children,
}: {
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  title?: string | null;
  description?: string | null;
  rows: SummaryRow[];
  total: SummaryRow;
  isTest?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="frame bg-white/60 shadow-[0_24px_60px_rgba(6,15,22,0.08)] backdrop-blur-sm">
      <div className="frame-inner overflow-hidden lg:grid lg:min-h-[600px] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ── Summary: compact strip on mobile ── */}
        <div className="flex items-center justify-between gap-4 border-b border-default-200 bg-default-50 px-5 py-4 lg:hidden">
          <div className="min-w-0">
            <p className="text-xs font-medium text-default-500">
              {merchantName ? "Paying" : "Order"}
            </p>
            <p className="truncate font-heading text-base font-semibold text-default-950">
              {merchantName || title || "Payment"}
            </p>
            {merchantName && title && (
              <p className="truncate text-xs text-default-600">{title}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-medium text-default-500">{total.label}</p>
            <div className="font-heading text-base font-semibold text-default-950">{total.value}</div>
            {isTest && (
              <div className="mt-1">
                <TestModeBadge />
              </div>
            )}
          </div>
        </div>

        {/* ── Summary: side panel on desktop ── */}
        <aside className="hidden flex-col border-r border-default-200 bg-default-50 p-8 lg:flex">
          {isTest && (
            <div className="mb-5">
              <TestModeBadge />
            </div>
          )}
          <p className="text-sm font-medium text-default-500">
            {merchantName ? "Paying" : "Order"}
          </p>
          <p className="mt-1 font-heading text-2xl leading-tight font-semibold tracking-[-0.02em] break-words text-default-950">
            {merchantName || title || "Payment"}
          </p>
          {merchantName && title && (
            <p className="mt-3 font-heading text-base font-semibold text-default-900">{title}</p>
          )}
          {description && (
            <p className="mt-1 text-sm leading-relaxed text-default-600">{description}</p>
          )}

          <dl className="mt-8 space-y-3 border-t border-default-200 pt-6 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4">
                <dt className="text-default-500">{row.label}</dt>
                <dd className="min-w-0 text-right font-medium break-all text-default-900">{row.value}</dd>
              </div>
            ))}
            <div className="flex items-start justify-between gap-4 border-t border-dashed border-default-300 pt-4">
              <dt className="font-semibold text-default-900">{total.label}</dt>
              <dd className="min-w-0 text-right font-heading text-lg font-semibold break-all text-default-950">
                {total.value}
              </dd>
            </div>
          </dl>

          <div className="mt-auto pt-10">
            {merchantLogoUrl ? (
              <MerchantLogo src={merchantLogoUrl} name={merchantName} className="max-h-12 max-w-[220px]" />
            ) : (
              <Logo className="gap-2" markClassName="size-6" />
            )}
          </div>
        </aside>

        {/* ── Steps ── */}
        <section className="min-w-0 px-5 pt-5 pb-6 sm:px-7 lg:p-8">{children}</section>
      </div>
    </div>
  );
}
