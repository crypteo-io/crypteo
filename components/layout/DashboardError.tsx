"use client";

import { ActionButton } from "@/components/dashboard/ActionButton";
import { motion } from "framer-motion";
import { AlertCircle, ChevronRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { AREA_HOME, type DashboardArea } from "./nav-items";

export interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Both dashboards' error boundary; `area` picks the overview link. */
export function DashboardError({ error, reset, area }: DashboardErrorProps & { area: DashboardArea }) {
  useEffect(() => {
    console.error("Dashboard Runtime Error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="frame w-full"
      >
        <div className="frame-inner p-7 text-center md:p-12">
          <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl border border-accent-red/15 bg-accent-red/5">
            <AlertCircle className="size-7 text-accent-red" />
          </div>

          <h1 className="mb-3 font-heading text-[24px] font-semibold leading-tight tracking-[-0.02em] text-default-950 md:text-[28px]">
            This page didn&apos;t load
          </h1>

          <p className="mx-auto mb-8 max-w-sm text-[15px] leading-relaxed text-default-600">
            Something went wrong while fetching this data. Try again, or head back to the overview.
          </p>
          {error.digest && (
            <p className="mx-auto -mt-4 mb-8 w-fit rounded-lg border border-default-200 bg-default-50 px-3 py-1.5 font-mono text-[12px] text-default-500">
              Ref: {error.digest}
            </p>
          )}

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ActionButton onClick={reset} variant="primary" className="w-full sm:w-auto">
              <RotateCcw size={16} /> Try again
            </ActionButton>
            <Link
              href={AREA_HOME[area]}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-default-200 bg-white px-6 py-3 text-[14px] font-semibold text-default-800 transition-colors hover:bg-default-50 sm:w-auto"
            >
              Back to overview <ChevronRight size={15} />
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
