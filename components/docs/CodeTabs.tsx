"use client";

import { copyWithToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Copy } from "lucide-react";
import { useState } from "react";

export interface CodeTabExample {
  label: string;
  code: string;
}

/** Tabbed code panel (cURL, Node.js, Python, …), the docs' one dark surface. */
export function CodeTabs({ examples }: { examples: CodeTabExample[] }) {
  const [active, setActive] = useState(0);
  const current = examples[active] ?? examples[0];
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl bg-default-950">
      <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-2">
        <div role="tablist" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {examples.map((ex, i) => (
            <button
              key={ex.label}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 font-mono text-xs transition-colors",
                i === active ? "bg-white/10 text-white" : "text-default-400 hover:text-default-100",
              )}
            >
              {ex.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => copyWithToast(current.code, "Code copied")}
          aria-label={`Copy ${current.label} example`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-default-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Copy size={15} />
        </button>
      </div>
      <pre className="max-h-[560px] overflow-auto p-4 font-mono text-[13px] leading-relaxed text-default-100">
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
