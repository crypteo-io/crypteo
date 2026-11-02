"use client";

import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

const COPIED_FLASH_MS = 1500;

/** Icon-only copy button for dark code panels; the icon itself is the confirmation. */
export function CopyButton({ text, label = "Copy code", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access. Select and copy it manually.");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-default-300 backdrop-blur transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {copied ? <Check size={16} className="text-emerald-300" /> : <Copy size={16} />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
