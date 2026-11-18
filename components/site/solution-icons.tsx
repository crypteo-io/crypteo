import type { SolutionKey } from "@/lib/content/solution-links";
import { Code2, GitBranch, Link2, Network, Palette, Puzzle, ShoppingCart } from "lucide-react";
import type { ComponentType } from "react";

type IconProps = { size?: number; className?: string };

/** Telegram's filled paper-plane logo, for the chat avatar in the Telegram illustration. */
export function TelegramLogo({ size = 24, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className={className}>
      <path d="m9.04 15.47-.37 5.2c.53 0 .76-.23 1.03-.5l2.48-2.37 5.14 3.76c.94.53 1.6.25 1.86-.87l3.37-15.8c.3-1.4-.5-1.94-1.42-1.6L1.34 10.9c-1.36.53-1.34 1.29-.23 1.63l5.07 1.58L17.95 6.7c.55-.37 1.06-.17.65.2L9.04 15.47Z" />
    </svg>
  );
}

/** Telegram's paper plane as a line icon (Tabler "brand-telegram", MIT), stroked like lucide's. */
export function TelegramIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
    </svg>
  );
}

/** One icon per solution, shared by the Solutions menu, the More ways cards and the home page's integrations. */
export const SOLUTION_ICONS: Record<SolutionKey, ComponentType<IconProps>> = {
  whiteLabel: Palette,
  openSource: GitBranch,
  api: Code2,
  decentralised: Network,
  development: Puzzle,
  wordpress: ShoppingCart,
  paymentLinks: Link2,
  telegram: TelegramIcon,
};
