"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef } from "react";
import { isActiveNav, tabGroups, type DashboardArea } from "./nav-items";

/** The dashboard's pages as a frosted tab strip over the sky header, groups side by side. */
export function SectionTabs({ area }: { area: DashboardArea }) {
  const pathname = usePathname() ?? "";
  const groups = tabGroups(area, pathname);
  const stripRef = useRef<HTMLElement>(null);

  // On a phone the strip scrolls sideways: keep the current page's tab in view.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip && tab) strip.scrollLeft = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
  }, [pathname]);

  if (groups.length === 0) return null;

  return (
    <nav ref={stripRef} aria-label="Sections" className="relative -mx-4 mb-8 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
      <ul className="inline-flex items-center gap-1 rounded-2xl border border-white/50 bg-white/40 p-1 backdrop-blur-sm">
        {groups.map((group, g) => (
          <Fragment key={group.label}>
            {g > 0 && <li aria-hidden className="mx-1.5 h-6 w-px shrink-0 bg-default-300/70" />}
            {group.items.map((item) => {
              const here = isActiveNav(area, pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={here ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-[14px] font-medium transition-colors",
                      here ? "bg-white text-default-950 shadow-premium" : "text-default-700 hover:bg-white/60 hover:text-default-950",
                    )}
                  >
                    <item.icon size={15} className={here ? "text-sky" : "text-default-500"} />
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
    </nav>
  );
}
