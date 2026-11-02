"use client";

import { apiRequest } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Bell, CheckCheck, CheckCircle2, Clock, Mail, Receipt, ServerCrash, ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { NOTIFICATIONS_PATH, type DashboardArea } from "./nav-items";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Feed {
  items: Item[];
  unread: number;
  unreadCapped: boolean;
}

// Polled while the tab is visible; a payment notification within a minute is
// enough for a dashboard, and hidden tabs cost nothing.
const POLL_MS = 60_000;

export const NOTIFICATION_ICONS: Record<string, { icon: typeof Bell; className: string }> = {
  payment_paid: { icon: CheckCircle2, className: "text-accent-green bg-accent-green/10" },
  payment_underpaid: { icon: AlertTriangle, className: "text-accent-orange bg-accent-orange/10" },
  payment_late: { icon: Clock, className: "text-accent-orange bg-accent-orange/10" },
  fee_invoice: { icon: Receipt, className: "text-sky bg-sky/10" },
  fee_reminder: { icon: Clock, className: "text-accent-orange bg-accent-orange/10" },
  fee_hold: { icon: ShieldAlert, className: "text-accent-red bg-accent-red/10" },
  fee_restored: { icon: CheckCircle2, className: "text-accent-green bg-accent-green/10" },
  fee_paid: { icon: CheckCircle2, className: "text-accent-green bg-accent-green/10" },
  admin_message: { icon: Mail, className: "text-default-800 bg-default-100" },
  admin_fee_received: { icon: Receipt, className: "text-accent-green bg-accent-green/10" },
  admin_billing_hold: { icon: ShieldAlert, className: "text-accent-red bg-accent-red/10" },
  admin_billing_error: { icon: AlertTriangle, className: "text-accent-red bg-accent-red/10" },
  admin_orphan: { icon: AlertTriangle, className: "text-accent-orange bg-accent-orange/10" },
  admin_fee_exemption: { icon: ShieldAlert, className: "text-accent-orange bg-accent-orange/10" },
  admin_contact: { icon: Mail, className: "text-sky bg-sky/10" },
  admin_proxy_failing: { icon: ServerCrash, className: "text-accent-red bg-accent-red/10" },
  admin_proxy_recovered: { icon: CheckCircle2, className: "text-accent-green bg-accent-green/10" },
  admin_probe: { icon: ShieldAlert, className: "text-amber-600 bg-amber-50" },
  admin_access: { icon: ShieldAlert, className: "text-accent-red bg-accent-red/10" },
};
export const FALLBACK_ICON = { icon: Bell, className: "text-default-600 bg-default-100" };

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function NotificationBell({ area }: { area: DashboardArea }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [failed, setFailed] = useState(false);
  const newestSeen = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<Feed>("/api/notifications");
      // Toast what arrived since the last poll (never on the first load).
      const newest = data.items[0]?.createdAt ?? null;
      const seen = newestSeen.current;
      if (seen !== null) {
        const fresh = data.items.filter((i) => !i.readAt && i.createdAt > seen);
        if (fresh.length === 1) toast.info(fresh[0].title, fresh[0].body);
        else if (fresh.length > 1) toast.info(`${fresh.length} new notifications`);
      }
      newestSeen.current = newest ?? newestSeen.current ?? "";
      setFeed(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick: the first load is a subscription like the polls, not a
    // render-time state update.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (body: { ids: string[] } | { all: true }) => {
    setFeed((f) =>
      f && {
        ...f,
        unread: "all" in body ? 0 : Math.max(0, f.unread - body.ids.length),
        items: f.items.map((i) =>
          "all" in body || body.ids.includes(i.id) ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i,
        ),
      },
    );
    try {
      await apiRequest("/api/notifications", { method: "PATCH", body });
    } catch (error) {
      toast.error("Couldn't mark as read", error instanceof Error ? error.message : undefined);
      void load();
    }
  };

  const openItem = (item: Item) => {
    if (!item.readAt) void markRead({ ids: [item.id] });
    if (item.link) {
      setOpen(false);
      router.push(item.link);
    }
  };

  const unread = feed?.unread ?? 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        className="relative flex size-10 items-center justify-center rounded-xl text-default-600 transition-colors hover:bg-default-100 hover:text-default-950 cursor-pointer"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Bell className="size-4.5" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-4.5 h-4.5 px-1 rounded-full bg-accent-red text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
            {feed?.unreadCapped ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute -right-24 mt-3 w-[min(92vw,380px)] bg-white border border-default-200 rounded-2xl shadow-card-hover z-50 overflow-hidden sm:right-0"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-default-100">
            <p className="font-heading text-[15px] font-semibold text-default-950">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => void markRead({ all: true })}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-default-500 hover:text-default-900 cursor-pointer"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-105 overflow-y-auto">
            {failed && !feed ? (
              <div className="px-5 py-10 text-center text-[13px] text-default-500">
                Notifications couldn&apos;t be loaded.{" "}
                <button onClick={() => void load()} className="font-semibold text-default-900 underline cursor-pointer">
                  Retry
                </button>
              </div>
            ) : !feed ? (
              <div className="px-5 py-10 text-center text-[13px] text-default-400">Loading…</div>
            ) : feed.items.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <Bell className="w-6 h-6 mx-auto text-default-300 mb-2" />
                <p className="text-[13px] text-default-500">You&apos;re all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-default-100">
                {feed.items.map((item) => {
                  const { icon: Icon, className } = NOTIFICATION_ICONS[item.kind] ?? FALLBACK_ICON;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => openItem(item)}
                        className={cn(
                          "w-full text-left flex gap-3 px-5 py-4 hover:bg-default-50 transition-colors cursor-pointer",
                          !item.readAt && "bg-sky/3",
                        )}
                      >
                        <span className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", className)}>
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className={cn("text-[13px] leading-snug text-default-900", !item.readAt && "font-semibold")}>
                              {item.title}
                            </span>
                            {!item.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-sky shrink-0" />}
                          </span>
                          <span className="text-[12px] text-default-500 mt-1 line-clamp-3 whitespace-pre-line">
                            {item.body}
                          </span>
                          <span className="block text-[11px] text-default-400 mt-1.5">{ago(item.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="px-5 py-3 border-t border-default-100 text-center">
            <Link
              href={NOTIFICATIONS_PATH[area]}
              onClick={() => setOpen(false)}
              className="text-[12px] font-semibold text-sky hover:underline"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
