"use client";

import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { Toaster } from "sileo";

// The dashboard's sticky top bar is 72px (h-18) and holds the account and
// log-out controls at the top right; toasts sit just below it, not over them.
const DASHBOARD_TOP_OFFSET_PX = 72 + 12;
const EDGE_OFFSET_PX = 16;
// Every surface is light now. sileo's "dark" theme is its LIGHT (white) fill,
// meant for dark UIs, so it is the one that matches the template's white cards.
const TOAST_THEME = "dark";
// sileo renders descriptions at 50% opacity, ~3:1 on white; this clears WCAG
// AA (4.5:1) for body text (slate-600 on white).
const DESCRIPTION_ON_LIGHT_FILL = "text-default-600!";
// The toast body is an SVG blob, so a CSS border can't follow its shape; a
// zero-blur drop shadow traces it as a hairline slate-200 edge instead.
// sileo capitalises every word of a title ("Endpoint Added"); Crypteo's copy is
// sentence case, so the text is shown as written.
const TOAST_EDGE_CSS = `[data-sileo-viewport] [data-sileo-svg]{filter:drop-shadow(0 0 0.75px #cbd5e1) drop-shadow(0 6px 16px rgba(6,15,22,0.08));}[data-sileo-viewport] [data-sileo-title]{text-transform:none;}`;

// The admin dashboard is the whole admin host, at bare paths (proxy.ts).
// The server render has no window: no toast is shown before hydration.
const subscribeNever = () => () => {};
const onAdminHost = () => window.location.hostname.startsWith("admin.");
// The admin host's sign-in pages (lib/host-routing.ts ADMIN_HOST_AUTH_PATHS),
// which have no top bar. Not imported: that module pulls in next/server.
const ADMIN_AUTH_PAGE = /^\/(login|forgot-password|reset-password)(\/|$)/;

/** Toasts (lib/toast.ts) and confirmations (useConfirm) for the whole app. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const adminHost = useSyncExternalStore(subscribeNever, onAdminHost, () => false);
  // On the admin host every page but sign-in is dashboard, under the top bar.
  const inDashboard = pathname.startsWith("/dashboard") || (adminHost && !ADMIN_AUTH_PAGE.test(pathname));
  const top = inDashboard ? DASHBOARD_TOP_OFFSET_PX : EDGE_OFFSET_PX;
  return (
    <ConfirmProvider>
      {children}
      <style>{TOAST_EDGE_CSS}</style>
      <Toaster
        position="top-right"
        theme={TOAST_THEME}
        offset={{ top, right: EDGE_OFFSET_PX }}
        options={{ styles: { description: DESCRIPTION_ON_LIGHT_FILL } }}
      />
    </ConfirmProvider>
  );
}
