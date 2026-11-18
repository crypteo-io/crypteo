import { solutionLink, type SolutionKey } from "@/lib/content/solution-links";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SOLUTION_ICONS } from "./solution-icons";

export interface SolutionCardItem {
  key: SolutionKey;
  /** Overrides the menu label, e.g. "Telegram bots" in the home page's integrations. */
  label?: string;
  blurb?: string;
}

const WIDTHS = {
  3: "sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.834rem)]",
  4: "sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.9375rem)]",
};

/**
 * Cards linking to solution pages. A flex row rather than a grid, so a
 * short last row sits centred instead of hanging off the left.
 */
export function SolutionCards({
  items,
  columns = 4,
  compact = false,
}: {
  items: SolutionCardItem[];
  columns?: 3 | 4;
  compact?: boolean;
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-4 lg:gap-5">
      {items.map((item) => {
        const link = solutionLink(item.key);
        const Icon = SOLUTION_ICONS[item.key];
        return (
          <li key={item.key} className={cn("w-full", WIDTHS[columns])}>
            <Link href={link.path} className="frame group block h-full transition-colors hover:border-default-300">
              <span
                className={cn(
                  "frame-inner flex h-full",
                  compact ? "items-start gap-4 p-5" : "flex-col p-5",
                )}
              >
                {compact ? (
                  <>
                    <IconTile icon={Icon} />
                    <span className="min-w-0 flex-1">
                      <Title>{item.label ?? link.label}</Title>
                      <Blurb className="mt-1">{item.blurb ?? link.blurb}</Blurb>
                    </span>
                    <Arrow className="mt-1" />
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-3">
                      <IconTile icon={Icon} />
                      <span className="min-w-0 flex-1">
                        <Title>{item.label ?? link.label}</Title>
                      </span>
                    </span>
                    <span className="mt-3.5 flex items-end justify-between gap-3">
                      <Blurb>{item.blurb ?? link.blurb}</Blurb>
                      <Arrow className="mb-0.5" />
                    </span>
                  </>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function IconTile({ icon: Icon }: { icon: (typeof SOLUTION_ICONS)[SolutionKey] }) {
  return (
    <span className="icon-tile size-11 shrink-0">
      <Icon size={20} />
    </span>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <span className="block font-heading text-[17px] font-semibold leading-snug text-default-950 transition-colors group-hover:text-sky">{children}</span>;
}

function Blurb({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block text-[15px] font-normal text-default-600", className)}>{children}</span>;
}

function Arrow({ className }: { className?: string }) {
  return (
    <ArrowUpRight
      size={18}
      className={cn(
        "shrink-0 text-default-400 transition-colors group-hover:text-sky",
        className,
      )}
    />
  );
}
