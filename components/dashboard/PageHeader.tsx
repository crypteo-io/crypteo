import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Page title row for every dashboard screen, set like the landing page's
 * section headings: a large title over the sky header, a muted line under it,
 * actions on the right.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  backHref,
  backLabel = "Back",
  badge,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-white/60 bg-white/60 px-3 py-1.5 text-[13px] font-medium text-default-700 backdrop-blur-sm transition-colors hover:bg-white hover:text-default-950"
          >
            <ArrowLeft size={15} /> {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="break-words text-[32px] leading-[1.1] tracking-[-0.03em] md:text-[44px]">{title}</h1>
          {badge}
        </div>
        {subtitle && <div className="mt-3 max-w-2xl text-[16px] text-default-700 md:text-[17px]">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
