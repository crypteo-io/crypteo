"use client";

import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

const COPIED_FLASH_MS = 1500;

/** Dark code panel with a caption and a copy button (the only dark surface on marketing pages). */
export function CodeBlock({
  code,
  title,
  className,
  tone = "default",
}: {
  code: string;
  title?: string;
  className?: string;
  /** "response" tints the text sky to tell responses from requests. */
  tone?: "default" | "response";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the code is
      // still selectable by hand.
    }
  };

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-2xl bg-default-950", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="truncate font-mono text-xs text-default-400">{title ?? "Example"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-default-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={15} className="text-sky-soft" /> : <Copy size={15} />}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto p-4 font-mono text-[13px] leading-relaxed",
          tone === "response" ? "text-sky-soft" : "text-default-100",
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
