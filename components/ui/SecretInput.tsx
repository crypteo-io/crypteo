"use client";

import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes } from "react";

/** The dashboard's secret field (Settings > Security). Auth pages pass their own `field` class. */
export const SECRET_FIELD =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-mono text-default-600 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all";

/**
 * An input hidden until its eye is pressed, each with its own toggle: every
 * password field and the admin's proxy URLs.
 *
 * `masking="password"` (default) is a real password input, so password
 * managers fill and save it. `masking="css"` hides a secret value that isn't a
 * login (a proxy URL with credentials) with CSS on a text input, so password
 * managers don't offer to save it as one.
 */
export function SecretInput({
  className,
  masking = "password",
  revealLabel = "password",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  masking?: "password" | "css";
  /** What the eye shows or hides, for its accessible name. */
  revealLabel?: string;
}) {
  const [shown, setShown] = useState(false);
  const css = masking === "css";
  return (
    <div className="relative">
      <input
        {...props}
        type={css || shown ? "text" : "password"}
        {...(css ? { autoComplete: "off", autoCorrect: "off", autoCapitalize: "off", spellCheck: false } : {})}
        className={cn(className ?? SECRET_FIELD, "pr-12", css && !shown && "[-webkit-text-security:disc]")}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={`${shown ? "Hide" : "Show"} ${revealLabel}`}
        aria-pressed={shown}
        className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-default-500 transition-colors hover:text-default-900"
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
