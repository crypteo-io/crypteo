import {
  BarChart3, Inbox, Key, LayoutDashboard, Link as LinkIcon, List, Newspaper, Palette, Receipt,
  Network, SearchCheck, Settings, TrendingUp, Users, Wallet, type LucideIcon,
} from "lucide-react";

/**
 * The two dashboards: merchants' under /dashboard on the site, and the admin
 * dashboard at the root of the admin host (lib/admin-host.ts, proxy.ts).
 */
export type DashboardArea = "merchant" | "admin";

export const AREA_HOME: Record<DashboardArea, string> = { merchant: "/dashboard", admin: "/" };
export const NOTIFICATIONS_PATH: Record<DashboardArea, string> = {
  merchant: "/dashboard/notifications",
  admin: "/notifications",
};

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Reached from the account menu, not the tab strip. */
  account?: boolean;
}

/**
 * Each dashboard's grouped navigation: the section tabs above each page and
 * the account menu. Admin pages are also gated by
 * the admin host (proxy.ts), adminPageSession and requireAdmin on their APIs.
 */
export function dashboardNav(area: DashboardArea): NavGroup[] {
  if (area === "admin") {
    return [
      {
        label: "Platform",
        items: [
          { name: "Overview", href: "/", icon: LayoutDashboard, description: "Live sessions across every merchant" },
          { name: "Analytics", href: "/analytics", icon: BarChart3, description: "Volume and conversion over time" },
          { name: "Revenue", href: "/revenue", icon: TrendingUp, description: "Fee schedule, statements and invoices" },
        ],
      },
      {
        label: "Merchants",
        items: [
          { name: "Merchants", href: "/merchants", icon: Users, description: "Accounts, access and messages" },
          { name: "Orphans", href: "/orphans", icon: SearchCheck, description: "Deposits no session claimed" },
          { name: "Contact", href: "/contact", icon: Inbox, description: "Contact form submissions" },
        ],
      },
      {
        label: "Content",
        items: [{ name: "Blog", href: "/blog", icon: Newspaper, description: "Posts, drafts and the image gallery" }],
      },
      {
        label: "Setup",
        items: [
          { name: "Fee wallets", href: "/wallets", icon: Wallet, description: "Where merchants pay their fees" },
          { name: "Proxies", href: "/proxies", icon: Network, description: "Outbound proxies for chain and price reads" },
        ],
      },
      {
        label: "Account",
        account: true,
        items: [{ name: "Settings", href: "/settings", icon: Settings, description: "Your admin account and security" }],
      },
    ];
  }
  return [
    {
      label: "Payments",
      items: [
        { name: "Overview", href: "/dashboard", icon: LayoutDashboard, description: "Today's volume and what's in flight" },
        { name: "Payments", href: "/dashboard/payments", icon: List, description: "Every checkout session and its status" },
        { name: "Payment links", href: "/dashboard/payment-links", icon: LinkIcon, description: "Reusable links to share or embed" },
      ],
    },
    {
      label: "Setup",
      items: [
        { name: "Wallets", href: "/dashboard/wallets", icon: Wallet, description: "Your self-custody receiving addresses" },
        { name: "API keys", href: "/dashboard/api-keys", icon: Key, description: "Live and test keys for your sites" },
        { name: "Checkout branding", href: "/dashboard/branding", icon: Palette, description: "Your logo and colour on checkout" },
      ],
    },
    {
      label: "Account",
      account: true,
      items: [
        { name: "Settings", href: "/dashboard/settings", icon: Settings, description: "Profile, security and webhooks" },
        { name: "Billing", href: "/dashboard/billing", icon: Receipt, description: "Platform fees and invoices" },
      ],
    },
  ];
}

/** The home entry matches only itself; every other entry its whole subtree. */
export function isActiveNav(area: DashboardArea, pathname: string, href: string): boolean {
  if (href === AREA_HOME[area]) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The group holding the page at `pathname`, or null (notifications, unknown paths). */
export function activeNavGroup(area: DashboardArea, pathname: string): NavGroup | null {
  return dashboardNav(area).find((g) => g.items.some((i) => isActiveNav(area, pathname, i.href))) ?? null;
}

/** The tab strip's groups: every tabbed group, or only the current one on an account page. */
export function tabGroups(area: DashboardArea, pathname: string): NavGroup[] {
  const current = activeNavGroup(area, pathname);
  if (!current?.account) return dashboardNav(area).filter((g) => !g.account);
  return current.items.length > 1 ? [current] : [];
}

/** The account menu's links. */
export function accountLinks(area: DashboardArea): NavItem[] {
  return dashboardNav(area)
    .filter((g) => g.account)
    .flatMap((g) => g.items);
}
