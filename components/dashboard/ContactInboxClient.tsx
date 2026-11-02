"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { apiRequest } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CheckCircle2, Inbox, Mail, RotateCcw, Search } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Message {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  handledAt: string | null;
  handledBy: string | null;
  /** What the message reads as a probe for, or null. */
  probe: string | null;
}

const FILTERS = ["new", "handled", "all"] as const;

export function ContactInboxClient({
  messages,
  unhandled,
  focusId,
}: {
  messages: Message[];
  unhandled: number;
  focusId: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(focusId ? "all" : "new");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [busy, setBusy] = useState(false);

  const q = query.toLowerCase();
  const shown = messages.filter(
    (m) =>
      (filter === "all" || (filter === "new" ? !m.handledAt : !!m.handledAt)) &&
      [m.name, m.email, m.subject ?? "", m.message].some((v) => v.toLowerCase().includes(q)),
  );
  const selected = messages.find((m) => m.id === selectedId) ?? shown[0] ?? null;

  const setHandled = async (m: Message, handled: boolean) => {
    setBusy(true);
    try {
      await toast.promise(
        apiRequest(`/api/admin/contact/${m.id}`, { method: "PATCH", body: { handled } }),
        { loading: "Saving…", success: handled ? "Marked handled" : "Moved back to new", error: "Not saved" },
      );
      router.refresh();
    } catch {
      // toast shown
    } finally {
      setBusy(false);
    }
  };

  const replyHref = (m: Message) =>
    `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject || "Your message to Crypteo"}`)}`;

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Contact"
        subtitle={`Contact form messages · ${unhandled} awaiting a reply`}
        actions={
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative md:w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-default-400" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search messages…"
                className="w-full pl-11 pr-4 h-11 bg-white border border-default-200 rounded-xl text-[14px] text-default-900 placeholder:text-default-400 focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex bg-white border border-default-200 rounded-xl p-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-[13px] font-semibold capitalize cursor-pointer",
                    filter === f ? "bg-primary text-white" : "text-default-500 hover:text-default-900",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6">
        <div className="frame-inner border-default-200 overflow-hidden">
          {shown.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Inbox className="w-7 h-7 mx-auto text-default-300 mb-2" />
              <p className="text-[14px] text-default-500">No messages here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-default-100 max-h-[70vh] overflow-y-auto">
              {shown.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "w-full text-left px-5 py-4 hover:bg-default-50 cursor-pointer",
                      selected?.id === m.id && "bg-default-50",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={cn("text-[14px] text-default-900 truncate", !m.handledAt && "font-semibold")}>{m.name}</p>
                      <span className="text-[11px] text-default-500 shrink-0">
                        <LocalDate value={m.createdAt} options={{ month: "short", day: "numeric" }} />
                      </span>
                    </div>
                    <p className="text-[13px] text-default-700 truncate mt-0.5">
                      {m.probe && (
                        <span title={`Reads as ${m.probe}`} className="mr-1.5 px-1.5 py-0.5 rounded-pill text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Probe
                        </span>
                      )}
                      {m.subject || "(no subject)"}
                    </p>
                    <p className="text-[12px] text-default-500 truncate mt-0.5">{m.message}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="frame-inner border-default-200 p-6 md:p-8 min-h-[300px]">
          {!selected ? (
            <p className="text-[14px] text-default-500">Select a message.</p>
          ) : (
            <article className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-[20px] font-heading font-semibold text-default-950 wrap-break-word">
                    {selected.subject || "(no subject)"}
                  </h2>
                  <p className="text-[13px] text-default-500 mt-1 break-all">
                    {selected.name} · {selected.email}
                  </p>
                  <p className="text-[12px] text-default-500 mt-1">
                    <LocalDate value={selected.createdAt} withTime />
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={replyHref(selected)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-deep"
                  >
                    <Mail size={14} /> Reply
                  </a>
                  {selected.handledAt ? (
                    <button
                      onClick={() => void setHandled(selected, false)}
                      disabled={busy}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-default-200 bg-white text-[13px] font-semibold text-default-800 hover:bg-default-50 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw size={14} /> Reopen
                    </button>
                  ) : (
                    <button
                      onClick={() => void setHandled(selected, true)}
                      disabled={busy}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-default-200 bg-white text-[13px] font-semibold text-default-800 hover:bg-default-50 disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 size={14} /> Mark handled
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[14px] text-default-800 leading-relaxed whitespace-pre-wrap wrap-break-word">
                {selected.message}
              </p>
              {selected.handledAt && (
                <p className="text-[12px] text-default-500 border-t border-default-100 pt-4">
                  Handled by {selected.handledBy ?? "an admin"} on <LocalDate value={selected.handledAt} withTime />
                </p>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
