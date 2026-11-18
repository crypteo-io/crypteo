"use client";

import { Modal, ModalActions } from "@/components/ui/Modal";
import { SUSPENSION_REASONS, type SuspensionReasonKey } from "@/lib/suspension-reasons";
import { useState } from "react";

const MIN_NOTE = 5;

/**
 * Suspend with a reason. The merchant is emailed a vague line for the reason
 * picked (lib/suspension-reasons.ts); an "Other" note stays on the record.
 */
export function SuspendDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (choice: { reason: SuspensionReasonKey; note?: string }) => Promise<void> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<SuspensionReasonKey | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isOther = reason === "other";
  const ready = reason !== "" && (!isOther || note.trim().length >= MIN_NOTE);

  const submit = async () => {
    if (reason === "") return;
    setBusy(true);
    try {
      await onSubmit(isOther ? { reason, note: note.trim() } : { reason });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Suspend this account?" onClose={onClose} busy={busy}>
      <p className="text-[14px] text-default-600 mt-2 leading-relaxed">
        Within 5 minutes the merchant is signed out, their API keys and payment links stop working, and nothing new can
        be paid. Checkouts already open are still watched, so buyers who paid get credited. Nothing is deleted. We email
        them a general reason and a link to appeal.
      </p>
      <label htmlFor="suspend-reason" className="block mt-5 text-[13px] font-medium text-default-700">
        Reason
      </label>
      <select
        id="suspend-reason"
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value as SuspensionReasonKey | "")}
        className="mt-1.5 w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] text-default-900 focus:outline-none focus:border-primary cursor-pointer"
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {SUSPENSION_REASONS.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>
      {isOther && (
        <>
          <label htmlFor="suspend-note" className="block mt-4 text-[13px] font-medium text-default-700">
            What happened? (kept on file, never emailed)
          </label>
          <textarea
            id="suspend-note"
            autoFocus
            rows={3}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1.5 w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] text-default-900 resize-y placeholder:text-default-400 focus:outline-none focus:border-primary"
          />
        </>
      )}
      <ModalActions
        onCancel={onClose}
        onConfirm={() => void submit()}
        busy={busy}
        disabled={!ready}
        danger
        confirmLabel="Suspend"
      />
    </Modal>
  );
}
