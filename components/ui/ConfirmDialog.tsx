"use client";

import { cn } from "@/lib/utils";
import { AlertTriangle, ShieldQuestion } from "lucide-react";
import {
    createContext, useCallback, useContext, useEffect, useId, useRef, useState,
    type ReactNode
} from "react";

export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for anything destructive or that locks someone out. */
  tone?: "danger" | "default";
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * `const confirm = useConfirm(); if (!(await confirm({...}))) return;`
 * One modal for every "are you sure": accessible (alertdialog, focus moves in
 * and comes back, Esc and the backdrop cancel), and focus starts on Cancel so
 * a stray Enter never confirms a destructive action.
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          // A second request while one is open cancels the first, never both.
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmModal options={pending} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  options,
  onClose,
}: {
  options: ConfirmOptions;
  onClose: (ok: boolean) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const danger = options.tone === "danger";

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(false);
      }
      if (e.key === "Tab" && dialogRef.current) {
        const buttons = dialogRef.current.querySelectorAll<HTMLElement>("button");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-default-950/40 backdrop-blur-sm animate-[confirm-fade-in_150ms_ease-out]"
        onClick={() => onClose(false)}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md bg-white border border-default-200 rounded-2xl p-6 sm:p-7 shadow-card-hover animate-[confirm-pop-in_180ms_ease-out]"
      >
        <div
          className={cn(
            "w-12 h-12 rounded-xl border flex items-center justify-center mb-5",
            danger ? "bg-accent-red/5 border-accent-red/15 text-accent-red" : "bg-linear-to-b from-default-100 to-transparent border-default-200 text-sky",
          )}
        >
          {danger ? <AlertTriangle size={22} /> : <ShieldQuestion size={22} />}
        </div>
        <h2 id={titleId} className="text-[20px] font-heading font-semibold text-default-950 tracking-tight">
          {options.title}
        </h2>
        <div id={descriptionId} className="text-[14px] text-default-600 leading-relaxed mt-2">
          {options.description}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-7">
          <button
            ref={cancelRef}
            onClick={() => onClose(false)}
            className="px-5 py-2.5 rounded-xl text-[14px] font-semibold text-default-700 bg-white border border-default-200 hover:text-default-950 hover:bg-default-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky/40"
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => onClose(true)}
            className={cn(
              "px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              danger
                ? "bg-accent-red hover:bg-accent-red/90 focus-visible:ring-accent-red"
                : "bg-primary hover:bg-primary-deep focus-visible:ring-primary",
            )}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
