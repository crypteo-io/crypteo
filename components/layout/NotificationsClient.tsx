"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { apiRequest } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { cn } from "@/lib/utils";
import { CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FALLBACK_ICON, NOTIFICATION_ICONS } from "./NotificationBell";

interface Item {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsClient({ items }: { items: Item[] }) {
  const router = useRouter();
  const unread = items.filter((i) => !i.readAt).length;

  const markAll = async () => {
    try {
      await toast.promise(apiRequest("/api/notifications", { method: "PATCH", body: { all: true } }), {
        loading: "Marking read…",
        success: "All caught up",
        error: "Couldn't mark them read",
      });
      router.refresh();
    } catch {
      // toast shown
    }
  };

  const markOne = (item: Item) => {
    if (item.readAt) return;
    void apiRequest("/api/notifications", { method: "PATCH", body: { ids: [item.id] } }).catch(() => undefined);
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          unread > 0 && (
          <button
            onClick={() => void markAll()}
            className="flex items-center gap-2 rounded-xl border border-default-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-default-800 transition-colors hover:bg-default-50 cursor-pointer"
          >
            <CheckCheck size={15} /> Mark all read
          </button>
          )
        }
      />

      <div className="frame">
      <div className="frame-inner overflow-hidden">
        {items.length === 0 ? (
          <p className="px-6 py-16 text-center text-[14px] text-default-500">No notifications yet.</p>
        ) : (
          <ul className="divide-y divide-default-100">
            {items.map((item) => {
              const { icon: Icon, className } = NOTIFICATION_ICONS[item.kind] ?? FALLBACK_ICON;
              const content = (
                <div className={cn("flex gap-4 px-6 py-5", !item.readAt && "bg-sky/3")}>
                  <span className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", className)}>
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={cn("text-[14px] text-default-900", !item.readAt && "font-semibold")}>{item.title}</p>
                      <span className="text-[12px] text-default-400">
                        <LocalDate value={item.createdAt} withTime />
                      </span>
                    </div>
                    <p className="text-[13px] text-default-600 mt-1 whitespace-pre-line wrap-break-word">{item.body}</p>
                  </div>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.link ? (
                    <Link href={item.link} onClick={() => markOne(item)} className="block hover:bg-default-50">
                      {content}
                    </Link>
                  ) : (
                    <button onClick={() => markOne(item)} className="block w-full text-left cursor-default">
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </div>
    </div>
  );
}
