"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";

export const CODE_LENGTH = 6;

/**
 * Six digit boxes over one real input, so paste, autofill of one-time codes
 * and screen readers all see an ordinary field.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  invalid,
  label,
}: {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  onComplete?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  /** For a field without a visible <label>. */
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={label}
        aria-invalid={invalid}
        required
        maxLength={CODE_LENGTH}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        onKeyDown={(e) => e.key === "Enter" && value.length === CODE_LENGTH && onComplete?.()}
        className="absolute inset-0 z-10 w-full cursor-text opacity-0 disabled:cursor-not-allowed"
      />
      <div aria-hidden className="grid grid-cols-6 gap-2 sm:gap-2.5">
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const caret = focused && i === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <span
              key={i}
              className={cn(
                "flex aspect-[4/5] max-h-16 items-center justify-center rounded-xl border-2 font-heading text-2xl font-semibold text-default-950 transition-all",
                value[i] ? "border-primary/70 bg-white" : "border-default-200 bg-default-50",
                caret && "border-sky bg-white ring-4 ring-sky/15",
                invalid && "border-accent-red/60",
                disabled && "opacity-60",
              )}
            >
              {value[i] ?? (caret && <span className="h-6 w-0.5 animate-pulse rounded bg-sky" />)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
