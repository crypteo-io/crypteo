"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { copyWithToast, errorMessage, toast } from "@/lib/toast";
import { Bell, BellOff, Copy, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "./ActionButton";

export interface TelegramChatRow {
  id: string;
  title: string;
  kind: string;
  notifyPaid: boolean;
}

interface ConnectCode {
  code: string;
  links: { chat: string; group: string; channel: string };
}

const KIND_LABEL: Record<string, string> = { private: "Private chat", group: "Group", supergroup: "Group", channel: "Channel" };
const LINK_CLASS = "inline-flex items-center gap-1.5 rounded-lg border border-default-200 px-3 py-2 text-sm font-medium hover:bg-default-50";

/** Connects Telegram chats: the bot then posts pay buttons there and, if asked, reports paid payments. */
export function TelegramCard({ chats }: { chats: TelegramChatRow[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [connect, setConnect] = useState<ConnectCode | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const issue = () => run(async () => setConnect(await apiRequest<ConnectCode>("/api/merchants/telegram", { method: "POST" })));
  const toggle = (chat: TelegramChatRow) =>
    run(() => apiRequest(`/api/merchants/telegram/${chat.id}`, { method: "PATCH", body: { notifyPaid: !chat.notifyPaid } }));
  const remove = async (chat: TelegramChatRow) => {
    const ok = await confirm({
      title: "Disconnect this chat?",
      description: `The bot stops working in ${chat.title}. Buttons already posted keep working until you disable their payment links.`,
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (ok) await run(() => apiRequest(`/api/merchants/telegram/${chat.id}`, { method: "DELETE" }));
  };

  return (
    <section className="frame">
      <div className="frame-inner p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="icon-tile size-10 shrink-0">
            <Send size={18} />
          </span>
          <div>
            <h2 className="font-heading text-[17px] font-semibold text-default-950">Telegram</h2>
            <p className="mt-0.5 text-[14px] text-default-500">
              Add the bot to a chat, group or channel, then post a pay button with <code>/pay 25 Blue hoodie</code>.
            </p>
          </div>
        </div>
        <ActionButton type="button" variant="secondary" className="px-4 py-2.5" onClick={issue} disabled={busy}>
          Connect a chat
        </ActionButton>
      </div>

      {connect && (
        <div className="mt-4 rounded-xl bg-default-50 p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <a className={LINK_CLASS} href={connect.links.chat} target="_blank" rel="noreferrer">
              Open a private chat
            </a>
            <a className={LINK_CLASS} href={connect.links.group} target="_blank" rel="noreferrer">
              Add to a group
            </a>
            <a className={LINK_CLASS} href={connect.links.channel} target="_blank" rel="noreferrer">
              Add to a channel
            </a>
          </div>
          <p className="mt-3 text-default-600">For a channel, add the bot as an admin, then post this in the channel:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2">/connect {connect.code}</code>
            <button
              type="button"
              aria-label="Copy the connect command"
              className={LINK_CLASS}
              onClick={() => copyWithToast(`/connect ${connect.code}`, "Copied")}
            >
              <Copy size={16} aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-xs text-default-500">The code works once and expires in 15 minutes.</p>
        </div>
      )}

      {chats.length > 0 && (
        <ul className="mt-4 divide-y divide-default-100">
          {chats.map((chat) => (
            <li key={chat.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-default-900">{chat.title}</p>
                <p className="text-xs text-default-500">{KIND_LABEL[chat.kind] ?? "Chat"}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busy}
                  className={LINK_CLASS}
                  aria-pressed={chat.notifyPaid}
                  aria-label={`Paid payment messages in ${chat.title}`}
                  title={chat.notifyPaid ? "Paid messages are on" : "Paid messages are off"}
                  onClick={() => toggle(chat)}
                >
                  {chat.notifyPaid ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={LINK_CLASS}
                  aria-label={`Disconnect ${chat.title}`}
                  onClick={() => remove(chat)}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}
