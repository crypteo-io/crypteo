"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

export type DocsNavGroup = { title: string; items: { id: string; label: string }[] };

/**
 * Section nav for the API reference: a sticky list on desktop that tracks the
 * section in view, and a jump-to select on mobile.
 */
export function DocsNav({ groups }: { groups: DocsNavGroup[] }) {
  const ids = groups.flatMap((g) => g.items.map((i) => i.id));
  const [active, setActive] = useState(ids[0]);
  const idsKey = ids.join(",");

  useEffect(() => {
    const sections = idsKey
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    // The band just under the floating navbar decides which section is "current".
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -65% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [idsKey]);

  return (
    <>
      <div className="lg:hidden">
        <label htmlFor="docs-jump" className="mb-2 block text-sm font-medium text-default-700">
          Jump to section
        </label>
        <div className="relative">
          <select
            id="docs-jump"
            className="field appearance-none pr-10"
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              document.getElementById(e.target.value)?.scrollIntoView({ behavior: "smooth" });
              history.replaceState(null, "", `#${e.target.value}`);
            }}
          >
            {groups.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-default-500"
          />
        </div>
      </div>

      <nav
        aria-label="API reference sections"
        className="sticky top-32 hidden max-h-[calc(100vh-9rem)] overflow-y-auto pb-6 lg:block"
      >
        {groups.map((g) => (
          <div key={g.title} className="mb-6">
            <p className="mb-2 px-3 text-xs font-semibold tracking-wider text-default-500 uppercase">
              {g.title}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((i) => (
                <li key={i.id}>
                  <a
                    href={`#${i.id}`}
                    aria-current={active === i.id ? "location" : undefined}
                    className={cn(
                      "block rounded-lg px-3 py-2 text-[15px] transition-colors",
                      active === i.id
                        ? "bg-default-100 font-medium text-primary"
                        : "text-default-600 hover:text-primary",
                    )}
                  >
                    {i.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
