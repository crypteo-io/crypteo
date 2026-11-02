"use client";

import { useState } from "react";
import { Modal, ModalActions } from "./Modal";
import { SecretInput } from "./SecretInput";

/**
 * A confirm that needs a short written answer: a reason on the record, or
 * (`secret`) the signed-in account's password. Resolves through onSubmit; the
 * caller closes it.
 */
export function PromptDialog({
  title,
  description,
  label,
  placeholder,
  minLength = 5,
  maxLength = 300,
  confirmLabel,
  danger,
  secret,
  onSubmit,
  onClose,
}: {
  title: string;
  description: string;
  label: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  confirmLabel: string;
  danger?: boolean;
  secret?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(secret ? value : value.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <p className="text-[14px] text-default-600 mt-2 leading-relaxed">{description}</p>
      <label className="block mt-5 text-[13px] font-medium text-default-700">{label}</label>
      {secret ? (
        <div className="mt-1.5">
          <SecretInput
            autoFocus
            autoComplete="current-password"
            value={value}
            maxLength={maxLength}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.length >= minLength && !busy) void submit();
            }}
          />
        </div>
      ) : (
        <textarea
          autoFocus
          rows={3}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1.5 w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] text-default-900 resize-y placeholder:text-default-400 focus:outline-none focus:border-primary"
        />
      )}
      <ModalActions
        onCancel={onClose}
        onConfirm={() => void submit()}
        busy={busy}
        disabled={value.trim().length < minLength}
        danger={danger}
        confirmLabel={confirmLabel}
      />
    </Modal>
  );
}
