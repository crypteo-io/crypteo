"use client";

import { cn } from "@/lib/utils";
import { useEffect, useId, type ReactNode } from "react";

/**
 * The shell every form dialog shares: backdrop, Escape and backdrop-click to
 * close (unless `busy`), scroll lock, and an accessible title. Confirmations
 * use useConfirm() (ConfirmDialog.tsx) instead.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  busy = false,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** While true, nothing closes the dialog (a request is in flight). */
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, busy]);

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-default-950/40 backdrop-blur-sm animate-[confirm-fade-in_150ms_ease-out]"
        onClick={() => !busy && onClose()}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative w-full max-w-md bg-white border border-default-200 rounded-2xl p-6 sm:p-7 shadow-card-hover max-h-[92vh] overflow-y-auto animate-[confirm-pop-in_180ms_ease-out]",
          className,
        )}
      >
        <h2 id={titleId} className="font-heading text-[20px] font-semibold tracking-[-0.02em] text-default-950">
          {title}
        </h2>
        {subtitle && <div className="text-[13px] text-default-500 mt-1 break-all">{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

/** Cancel + primary action, right-aligned, stacked on phones. */
export function ModalActions({
  onCancel,
  busy,
  disabled,
  danger,
  confirmLabel,
  onConfirm,
}: {
  onCancel: () => void;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  confirmLabel: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-6">
      <button
        onClick={onCancel}
        disabled={busy}
        className="px-5 py-2.5 rounded-xl text-[14px] font-semibold text-default-800 bg-white border border-default-200 hover:bg-default-50 hover:border-default-300 cursor-pointer"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || disabled}
        className={cn(
          "flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white disabled:opacity-40 cursor-pointer",
          danger ? "bg-accent-red hover:bg-accent-red/90" : "bg-primary shadow-aigocy-dark hover:bg-primary-deep",
        )}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
