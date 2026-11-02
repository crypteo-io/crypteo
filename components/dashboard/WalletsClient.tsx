"use client";

import { SelfCustodyTip } from "@/components/SelfCustodyTip";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ChainIcon } from "@/components/ui/ChainIcon";
import { CODE_LENGTH, CodeInput } from "@/components/ui/CodeInput";
import { Modal, ModalActions } from "@/components/ui/Modal";
import { ApiError, apiRequest } from "@/lib/api-client";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { slotKey, WALLET_ASSETS, type WalletAsset, type WalletSlot } from "@/lib/wallet-slots";
import type { Wallet } from "@/types/payment";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "./PageHeader";

type Status = "ready" | "partial" | "unset" | "attention";
type Draft = { address: string; xrpTag: string };
type SaveBody = { chain: string; token: string; address: string; isActive: boolean; xrpTag: string | null; code?: string };

const STATUS: Record<Status, { label: string; dot: string; bar: string }> = {
  ready: { label: "Ready", dot: "bg-accent-green", bar: "bg-accent-green" },
  partial: { label: "Partly set", dot: "bg-sky", bar: "bg-sky" },
  unset: { label: "Not set", dot: "bg-default-300", bar: "bg-default-200" },
  attention: { label: "Needs attention", dot: "bg-accent-red", bar: "bg-accent-red" },
};

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

const SLOT_COUNT = WALLET_ASSETS.reduce((n, a) => n + a.slots.length, 0);

export function WalletsClient({
  wallets: initial,
  invalidAddresses = {},
}: {
  wallets: Wallet[];
  /** Saved addresses that aren't valid on their chain, by `${chain}-${token}`. */
  invalidAddresses?: Record<string, string>;
}) {
  const [wallets, setWallets] = useState(() => new Map(initial.map((w) => [slotKey(w.chain, w.token), w])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; body: SaveBody; method: string } | null>(null);
  const [selected, setSelected] = useState(WALLET_ASSETS[0].id);
  const confirm = useConfirm();

  const isInvalid = (key: string) => {
    const w = wallets.get(key);
    return !!w && invalidAddresses[key] === w.address;
  };
  const statusOf = (asset: WalletAsset): Status => {
    const keys = asset.slots.map((s) => slotKey(s.chain, s.token));
    if (keys.some(isInvalid)) return "attention";
    const set = keys.filter((k) => wallets.has(k)).length;
    return set === 0 ? "unset" : set === keys.length ? "ready" : "partial";
  };
  const setError = (key: string, message?: string) =>
    setErrors((prev) => (message ? { ...prev, [key]: message } : without(prev, key)));
  const closeDraft = (key: string) => setDrafts((prev) => without(prev, key));

  const applySaved = (key: string, wallet: Wallet) => {
    setWallets((prev) => new Map(prev).set(key, wallet));
    closeDraft(key);
    setError(key);
  };

  const post = (body: SaveBody) => apiRequest<Wallet>("/api/wallets", { method: "POST", body });

  /** Saves the draft; a new or changed address comes back asking for the second factor. */
  const saveDraft = async (slot: WalletSlot) => {
    const key = slotKey(slot.chain, slot.token);
    const draft = drafts[key];
    if (!draft?.address.trim()) return;
    const body: SaveBody = {
      chain: slot.chain,
      token: slot.token,
      address: draft.address.trim(),
      isActive: wallets.get(key)?.isActive ?? true,
      xrpTag: slot.chain === "xrp" ? draft.xrpTag.trim() || null : null,
    };
    setBusy(key);
    setError(key);
    try {
      applySaved(key, await post(body));
      toast.success(`${slot.network} address saved`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        try {
          const { method } = await apiRequest<{ method: string }>("/api/wallets/verification", { method: "POST" });
          setPending({ key, body, method });
        } catch (e) {
          setError(key, errorMessage(e, "Couldn't send a verification code. Try again."));
        }
      } else {
        setError(key, errorMessage(err, "Failed to save the address. Try again."));
      }
    } finally {
      setBusy(null);
    }
  };

  const submitCode = async (code: string) => {
    if (!pending) return;
    const { key, body } = pending;
    try {
      applySaved(key, await post({ ...body, code }));
      setPending(null);
      toast.success("Address saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && /code/i.test(err.message)) throw err;
      setPending(null);
      setError(key, errorMessage(err, "Failed to save the address. Try again."));
    }
  };

  const toggle = async (slot: WalletSlot, wallet: Wallet) => {
    const key = slotKey(slot.chain, slot.token);
    const enable = !wallet.isActive;
    const ok = await confirm(
      enable
        ? { title: `Accept ${slot.network} again?`, description: "Buyers can pick it at checkout again.", confirmLabel: "Enable" }
        : {
            title: `Pause ${slot.network}?`,
            description: "It stops appearing at checkout until you enable it. Checkouts already on it keep being watched.",
            confirmLabel: "Pause",
            tone: "danger",
          },
    );
    if (!ok) return;
    setBusy(key);
    try {
      const saved = await toast.promise(
        post({ chain: slot.chain, token: slot.token, address: wallet.address, isActive: enable, xrpTag: wallet.xrpTag ?? null }),
        { loading: enable ? "Enabling…" : "Pausing…", success: enable ? "Enabled" : "Paused", error: "Wallet not changed" },
      );
      applySaved(key, saved);
    } catch {
      // The toast says why.
    } finally {
      setBusy(null);
    }
  };

  const remove = async (slot: WalletSlot) => {
    const key = slotKey(slot.chain, slot.token);
    const ok = await confirm({
      title: `Remove the ${slot.network} address?`,
      description: "Buyers can no longer pay with it. Checkouts already on it keep being watched, and past payments are kept.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(key);
    try {
      await toast.promise(apiRequest("/api/wallets", { method: "DELETE", body: { chain: slot.chain, token: slot.token } }), {
        loading: "Removing…",
        success: "Address removed",
        error: "Address not removed",
      });
      setWallets((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      closeDraft(key);
    } catch {
      // The toast says why.
    } finally {
      setBusy(null);
    }
  };

  const asset = WALLET_ASSETS.find((a) => a.id === selected) ?? WALLET_ASSETS[0];
  const assetStatus = STATUS[statusOf(asset)];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Wallets"
        subtitle={`Where your payments land. ${wallets.size} of ${SLOT_COUNT} addresses set; changing one needs a verification code.`}
      />

      <div className="frame">
        <div className="frame-inner p-4 sm:p-5">
          <div className="flex gap-1" aria-hidden>
            {WALLET_ASSETS.map((a) => (
              <span key={a.id} className={cn("h-1.5 flex-1 rounded-full", STATUS[statusOf(a)].bar)} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-default-500">
            {(Object.keys(STATUS) as Status[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", STATUS[s].dot)} />
                {STATUS[s].label}: {WALLET_ASSETS.filter((a) => statusOf(a) === s).length}
              </span>
            ))}
          </div>
        </div>
      </div>

      <SelfCustodyTip collapsible defaultOpen={wallets.size === 0} />

      <div className="grid items-start gap-5 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Assets" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          <ul className="flex gap-1.5 lg:flex-col">
            {WALLET_ASSETS.map((a) => {
              const here = a.id === asset.id;
              const set = a.slots.filter((s) => wallets.has(slotKey(s.chain, s.token))).length;
              return (
                <li key={a.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelected(a.id)}
                    aria-current={here ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      here ? "border-default-200 bg-white shadow-premium" : "border-transparent hover:bg-white/70",
                    )}
                  >
                    <ChainIcon chain={a.icon} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap text-[14px] font-semibold text-default-950">{a.name}</span>
                      <span className="hidden text-[12px] text-default-500 lg:block">
                        {set} of {a.slots.length} {a.slots.length === 1 ? "address" : "networks"}
                      </span>
                    </span>
                    <span className={cn("size-2 shrink-0 rounded-full", STATUS[statusOf(a)].dot)} aria-label={STATUS[statusOf(a)].label} />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="frame" aria-labelledby="asset-heading">
          <div className="frame-inner p-5 sm:p-7">
            <header className="mb-6 flex items-center gap-4">
              <ChainIcon chain={asset.icon} size={44} />
              <div className="min-w-0 flex-1">
                <h2 id="asset-heading" className="font-heading text-[22px] font-semibold text-default-950">
                  {asset.name}
                </h2>
                <p className="inline-flex items-center gap-1.5 text-[13px] text-default-500">
                  <span className={cn("size-2 rounded-full", assetStatus.dot)} /> {assetStatus.label}
                </p>
              </div>
            </header>

            <ul className="divide-y divide-default-100">
              {asset.slots.map((slot) => {
                const key = slotKey(slot.chain, slot.token);
                const wallet = wallets.get(key);
                const draft = drafts[key] ?? (wallet ? undefined : { address: "", xrpTag: "" });
                return (
                  <li key={key} className="py-5 first:pt-0 last:pb-0">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[14px] font-semibold text-default-900">{slot.network}</h3>
                      {wallet && (
                        <SlotState invalid={isInvalid(key)} active={wallet.isActive} />
                      )}
                    </div>
                    {draft ? (
                      <SlotEditor
                        slot={slot}
                        draft={draft}
                        busy={busy === key}
                        error={errors[key]}
                        onChange={(d) => {
                          setError(key);
                          setDrafts((prev) => ({ ...prev, [key]: d }));
                        }}
                        onSave={() => void saveDraft(slot)}
                        onCancel={wallet ? () => closeDraft(key) : undefined}
                      />
                    ) : (
                      wallet && (
                        <SlotView
                          wallet={wallet}
                          invalid={isInvalid(key)}
                          busy={busy === key}
                          onEdit={() => setDrafts((prev) => ({ ...prev, [key]: { address: wallet.address, xrpTag: wallet.xrpTag ?? "" } }))}
                          onToggle={() => void toggle(slot, wallet)}
                          onRemove={() => void remove(slot)}
                        />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>

      <p className="text-[13px] text-default-500">
        Payments go straight to these addresses and can&apos;t be reversed, so check each one against your wallet before saving.
      </p>

      {pending && <CodeDialog method={pending.method} onSubmit={submitCode} onClose={() => setPending(null)} />}
    </div>
  );
}

function SlotState({ invalid, active }: { invalid: boolean; active: boolean }) {
  const [label, tone] = invalid
    ? ["Invalid address", "bg-accent-red/10 text-accent-red"]
    : active
      ? ["Accepting payments", "bg-accent-green/10 text-accent-green"]
      : ["Paused", "bg-default-100 text-default-600"];
  return <span className={cn("rounded-pill px-2.5 py-0.5 text-[11px] font-semibold", tone)}>{label}</span>;
}

function SlotView({
  wallet,
  invalid,
  busy,
  onEdit,
  onToggle,
  onRemove,
}: {
  wallet: Wallet;
  invalid: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(wallet.address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const action = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50";
  return (
    <div className={cn("rounded-xl bg-default-50 p-3.5", invalid && "ring-1 ring-accent-red/30")}>
      <p className={cn("break-all font-mono text-[13px] leading-snug", wallet.isActive ? "text-default-900" : "text-default-400")}>
        {wallet.address}
      </p>
      {wallet.xrpTag && <p className="mt-1 text-[12px] text-default-500">Destination tag {wallet.xrpTag}</p>}
      {invalid && (
        <p className="mt-2 text-[12px] text-accent-red">
          This address isn&apos;t valid on this network, so checkout no longer offers it. Change it to a valid one.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => void copy()} className={cn(action, "text-default-700 hover:bg-white")}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={onEdit} disabled={busy} className={cn(action, "text-default-700 hover:bg-white")}>
          <Pencil size={14} /> Change
        </button>
        <span className="ml-auto inline-flex items-center gap-2 text-[13px] font-medium text-default-700">
          <span aria-hidden>Accept</span>
          <button
            type="button"
            role="switch"
            aria-checked={wallet.isActive}
            aria-label="Accept payments to this address"
            onClick={onToggle}
            disabled={busy}
            className={cn(
              "relative h-5 w-9 rounded-full transition-colors disabled:opacity-50",
              wallet.isActive ? "bg-primary" : "bg-default-300",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform",
                wallet.isActive && "translate-x-4",
              )}
            />
          </button>
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label="Remove address"
          className={cn(action, "text-default-500 hover:bg-accent-red/5 hover:text-accent-red")}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function SlotEditor({
  slot,
  draft,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  slot: WalletSlot;
  draft: Draft;
  busy: boolean;
  error?: string;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const input =
    "w-full rounded-xl border bg-white px-3.5 py-2.5 font-mono text-[13px] text-default-900 placeholder:text-default-400 focus:border-sky focus:outline-none focus:ring-4 focus:ring-sky/10";
  return (
    <div className="space-y-2.5">
      <input
        type="text"
        value={draft.address}
        onChange={(e) => onChange({ ...draft, address: e.target.value })}
        placeholder={slot.placeholder ?? `Your ${slot.token.toUpperCase()} address on ${slot.network}`}
        aria-label={`${slot.network} address`}
        aria-invalid={!!error}
        spellCheck={false}
        autoComplete="off"
        className={cn(input, error ? "border-accent-red" : "border-default-200")}
      />
      {slot.chain === "xrp" && (
        <input
          type="text"
          inputMode="numeric"
          value={draft.xrpTag}
          onChange={(e) => onChange({ ...draft, xrpTag: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          placeholder="Destination tag, if your wallet uses one"
          aria-label="XRP destination tag"
          className={cn(input, "border-default-200")}
        />
      )}
      {error && <p className="text-[12px] text-accent-red">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !draft.address.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-primary-deep disabled:opacity-40"
        >
          {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
          Save address
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-[13px] font-semibold text-default-700 hover:bg-default-100"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function CodeDialog({ method, onSubmit, onClose }: { method: string; onSubmit: (code: string) => Promise<void>; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
    } catch (err) {
      setError(errorMessage(err, "That code didn't work."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Confirm with a code" onClose={onClose} busy={busy}>
      <p className="mt-2 text-[14px] leading-relaxed text-default-600">
        {method === "totp"
          ? "Enter the 6-digit code from your authenticator app to change where payments go."
          : "We emailed you a 6-digit code. Enter it to change where payments go. It lasts 30 minutes."}
      </p>
      <div className="mt-5">
        <CodeInput value={code} onChange={setCode} onComplete={() => !busy && void submit()} disabled={busy} invalid={!!error} autoFocus label="Verification code" />
      </div>
      {error && <p className="mt-2 text-[13px] text-accent-red">{error}</p>}
      <ModalActions onCancel={onClose} onConfirm={() => void submit()} busy={busy} disabled={code.length !== CODE_LENGTH} confirmLabel="Confirm change" />
    </Modal>
  );
}
