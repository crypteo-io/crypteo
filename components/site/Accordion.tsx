"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

/** The template's FAQ accordion: soft slate panels, one open at a time. */
export function Accordion({
  items,
  defaultOpen = 0,
}: {
  items: { q: string; a: string }[];
  defaultOpen?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  const base = useId();

  return (
    <div className="space-y-4 md:space-y-5">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className="panel-soft p-5">
            <h3 className="text-lg md:text-xl">
              <button
                type="button"
                id={`${base}-q${i}`}
                aria-expanded={isOpen}
                aria-controls={`${base}-a${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                {item.q}
                <ChevronDown
                  size={22}
                  className={cn("shrink-0 transition-transform duration-300", isOpen && "rotate-180")}
                />
              </button>
            </h3>
            <div
              id={`${base}-a${i}`}
              role="region"
              aria-labelledby={`${base}-q${i}`}
              className={cn(
                "grid transition-[grid-template-rows] duration-300",
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="overflow-hidden">
                <p className="pt-4 text-default-600">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
