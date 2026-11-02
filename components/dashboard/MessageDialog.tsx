"use client";

import { apiRequest, ApiError } from "@/lib/api-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { BODY_MAX, MAX_EMAIL_RECIPIENTS, TITLE_MAX } from "@/lib/notification-limits";
import { Bell, Mail, Send } from "lucide-react";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { useState } from "react";

export type MessageAudience =
  | { kind: "direct"; merchants: { id: string; name: string; email: string }[] }
  | { kind: "all_merchants"; count: number };

const inputClass =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 placeholder:text-default-400 focus:outline-none focus:border-primary";

/**
 * Write to one merchant (or all of them) by email, in their dashboard bell, or
 * both, without leaving the page. The API audits every recipient.
 */
export function MessageDialog({
  audience,
  onClose,
  initialSubject = "",
}: {
  audience: MessageAudience;
  onClose: () => void;
  initialSubject?: string;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState("");
  const broadcast = audience.kind === "all_merchants";
  const [email, setEmail] = useState(!broadcast);
  const [inApp, setInApp] = useState(true);
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);

  const send = async () => {
    setFieldError(null);
    setSending(true);
    try {
      const result = await toast.promise(
        apiRequest<{ recipients: number; emailed: number; notified: number }>("/api/admin/messages", {
          method: "POST",
          body: {
            ...(broadcast ? { audience: "all_merchants" } : { merchantIds: audience.merchants.map((m) => m.id) }),
            subject,
            message,
            email,
            inApp,
          },
        }),
        { loading: "Sending…", success: "Message sent", error: "Message not sent" },
      );
      if (email && result.emailed < result.recipients) {
        toast.warning(
          "Some emails didn't go out",
          `${result.emailed} of ${result.recipients} accepted by the mail server.`,
        );
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setFieldError({ field: error.field, message: error.message });
      setSending(false);
    }
  };

  const to = broadcast
    ? `All active merchants (${audience.count})`
    : audience.merchants.map((m) => `${m.name} <${m.email}>`).join(", ");

  return (
    <Modal
      title={broadcast ? "Message all merchants" : "Send a message"}
      subtitle={`To: ${to}`}
      onClose={onClose}
      busy={sending}
      className="max-w-lg"
    >
      <div className="space-y-4 mt-5">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-default-700 pl-1">Subject</label>
          <input
            autoFocus
            value={subject}
            maxLength={TITLE_MAX}
            onChange={(e) => setSubject(e.target.value)}
            className={cn(inputClass, fieldError?.field === "subject" && "border-accent-red")}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-default-700 pl-1">Message</label>
          <textarea
            value={message}
            rows={7}
            maxLength={BODY_MAX}
            onChange={(e) => setMessage(e.target.value)}
            className={cn(inputClass, "resize-y", fieldError?.field === "message" && "border-accent-red")}
            placeholder="Plain text. Blank lines start a new paragraph."
          />
          <p className="text-[11px] text-default-500 text-right">
            {message.length}/{BODY_MAX}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Channel checked={email} onChange={setEmail} icon={Mail} label="Email" />
          <Channel checked={inApp} onChange={setInApp} icon={Bell} label="Dashboard notification" />
        </div>
        {broadcast && (
          <p className="text-[12px] text-default-500">
            Email goes to at most {MAX_EMAIL_RECIPIENTS} accounts at once; larger broadcasts go to the dashboard only.
          </p>
        )}
        {fieldError && <p className="text-[13px] font-medium text-accent-red">{fieldError.message}</p>}
      </div>
      <ModalActions
        onCancel={onClose}
        onConfirm={() => void send()}
        busy={sending}
        disabled={!subject.trim() || !message.trim() || (!email && !inApp)}
        confirmLabel={
          <>
            <Send size={15} /> {sending ? "Sending…" : "Send"}
          </>
        }
      />
    </Modal>
  );
}

function Channel({
  checked,
  onChange,
  icon: Icon,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: typeof Mail;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13px] font-semibold cursor-pointer select-none transition-colors",
        checked ? "border-primary bg-primary text-white" : "border-default-200 bg-white text-default-600 hover:bg-default-50",
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <Icon size={14} /> {label}
    </label>
  );
}
