"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SecretInput } from "@/components/ui/SecretInput";
import { ApiError, apiRequest } from "@/lib/api-client";
import { copyWithToast, errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Check,
  Globe,
  Pencil,
  Plus,
  Send,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionButton } from "./ActionButton";

interface Health {
  attempts: number;
  failures: number;
  failing: boolean;
  lastStatusCode: number | null;
  lastAt: string;
}

interface Endpoint {
  id: string;
  url: string;
  label: string | null;
  isActive: boolean;
  isDefault: boolean;
  health: Health | null;
  /** Active API keys / payment links that send to this endpoint. */
  apiKeys: number;
  paymentLinks: number;
}

const inputClass =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-mono text-default-700 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all";
const labelClass =
  "block text-[13px] font-medium text-default-700 pl-1 mb-2";

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 pl-1 text-[12px] text-accent-red">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function HealthPill({ endpoint }: { endpoint: Endpoint }) {
  const h = endpoint.health;
  if (!endpoint.isActive) {
    return <Pill className="bg-default-100 text-default-500">Paused</Pill>;
  }
  if (!h) return <Pill className="bg-default-100 text-default-500">No deliveries yet</Pill>;
  if (h.failing) {
    return (
      <Pill className="bg-accent-red/10 text-accent-red">
        Failing{h.lastStatusCode ? ` · HTTP ${h.lastStatusCode}` : " · no response"}
      </Pill>
    );
  }
  return <Pill className="bg-accent-green/10 text-accent-green">Delivering</Pill>;
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

/**
 * Settings → Webhooks: one endpoint per site, plus the signing secret they
 * share. Each payment goes to exactly one endpoint: the one its API key or
 * payment link names, else the default (lib/payment/notify.ts webhookTarget).
 */
export function WebhookSettings() {
  const confirm = useConfirm();
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [max, setMax] = useState(10);
  const [loadFailed, setLoadFailed] = useState(false);

  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [savingSecret, setSavingSecret] = useState(false);

  const load = () => {
    setLoadFailed(false);
    apiRequest<{ endpoints: Endpoint[]; max: number }>("/api/merchants/webhook-endpoints")
      .then((d) => {
        setEndpoints(d.endpoints);
        setMax(d.max);
      })
      .catch(() => setLoadFailed(true));
  };

  useEffect(() => {
    load();
    apiRequest<{ webhookSecret: string | null }>("/api/merchants/webhook")
      .then((d) => setSecret(d.webhookSecret ?? ""))
      .catch(() => {});
  }, []);

  const addEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      const { endpoint } = await apiRequest<{ endpoint: Endpoint }>(
        "/api/merchants/webhook-endpoints",
        { method: "POST", body: { url: newUrl, label: newLabel || null } },
      );
      setEndpoints((prev) => [...(prev ?? []), endpoint]);
      if (endpoint.isDefault) {
        toast.info("Set as your default endpoint", "Payments with no other destination go here.");
      }
      setNewUrl("");
      setNewLabel("");
      toast.success("Endpoint added", "Send a test event to check it accepts deliveries.");
    } catch (err) {
      // Validation problems belong under the URL field, not in a toast.
      if (err instanceof ApiError && err.status < 500) setAddError(err.message);
      else toast.error("Endpoint not added", errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (ep: Endpoint) => {
    setEditingId(ep.id);
    setEditUrl(ep.url);
    setEditLabel(ep.label ?? "");
    setEditError(null);
  };

  const saveEdit = async (ep: Endpoint) => {
    setEditError(null);
    setBusyId(ep.id);
    try {
      const { endpoint } = await apiRequest<{ endpoint: Omit<Endpoint, "health"> }>(
        `/api/merchants/webhook-endpoints/${ep.id}`,
        { method: "PATCH", body: { url: editUrl, label: editLabel || null } },
      );
      setEndpoints((prev) =>
        (prev ?? []).map((x) =>
          x.id === ep.id
            ? { ...x, ...endpoint, health: endpoint.url === x.url ? x.health : null }
            : x,
        ),
      );
      setEditingId(null);
      toast.success("Endpoint updated");
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) setEditError(err.message);
      else toast.error("Endpoint not updated", errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (ep: Endpoint) => {
    if (ep.isActive) {
      const ok = await confirm({
        title: "Pause this endpoint?",
        description: (
          <>
            <span className="font-mono break-all">{ep.url}</span> stops receiving payment
            updates until you resume it
            {ep.isDefault ? ", including every payment that uses the default" : ""}. Events
            sent while paused are not replayed or sent anywhere else.
          </>
        ),
        confirmLabel: "Pause endpoint",
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusyId(ep.id);
    try {
      await toast.promise(
        apiRequest(`/api/merchants/webhook-endpoints/${ep.id}`, {
          method: "PATCH",
          body: { isActive: !ep.isActive },
        }),
        {
          loading: ep.isActive ? "Pausing…" : "Resuming…",
          success: ep.isActive ? "Endpoint paused" : "Endpoint resumed",
        },
      );
      setEndpoints((prev) =>
        (prev ?? []).map((x) => (x.id === ep.id ? { ...x, isActive: !ep.isActive } : x)),
      );
    } catch {
      // toast.promise showed it
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (ep: Endpoint) => {
    const ok = await confirm({
      title: "Delete this endpoint?",
      description: (
        <>
          <span className="font-mono break-all">{ep.url}</span> will stop receiving payment
          updates.
          {ep.isDefault
            ? " It is your default endpoint: payments with no other destination will notify no site until you make another endpoint the default."
            : ""}
        </>
      ),
      confirmLabel: "Delete endpoint",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(ep.id);
    try {
      await toast.promise(
        apiRequest(`/api/merchants/webhook-endpoints/${ep.id}`, { method: "DELETE" }),
        { loading: "Deleting…", success: "Endpoint deleted", error: "Endpoint not deleted" },
      );
      setEndpoints((prev) => (prev ?? []).filter((x) => x.id !== ep.id));
    } catch {
      // toast.promise showed it
    } finally {
      setBusyId(null);
    }
  };

  const makeDefault = async (ep: Endpoint) => {
    setBusyId(ep.id);
    try {
      await toast.promise(
        apiRequest(`/api/merchants/webhook-endpoints/${ep.id}`, {
          method: "PATCH",
          body: { isDefault: true },
        }),
        { loading: "Saving…", success: "Default endpoint changed" },
      );
      setEndpoints((prev) => (prev ?? []).map((x) => ({ ...x, isDefault: x.id === ep.id })));
    } catch {
      // toast.promise showed it
    } finally {
      setBusyId(null);
    }
  };

  const sendTest = async (ep: Endpoint) => {
    setBusyId(ep.id);
    try {
      const r = await apiRequest<{ success: boolean; statusCode: number | null }>(
        `/api/merchants/webhook-endpoints/${ep.id}/test`,
        { method: "POST" },
      );
      if (r.success) {
        toast.success("Test event delivered", `${ep.url} answered HTTP ${r.statusCode}.`);
      } else {
        toast.error(
          "Test event not accepted",
          r.statusCode === 405
            ? "HTTP 405: this URL doesn't accept POST. It is probably a page of your website, not a server route."
            : r.statusCode
              ? `The endpoint answered HTTP ${r.statusCode}. It must answer 2xx.`
              : "No response: the endpoint couldn't be reached within 10 seconds.",
        );
      }
    } catch (err) {
      toast.error("Test not sent", errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const saveSecret = async () => {
    setSecretError(null);
    setSavingSecret(true);
    try {
      await apiRequest("/api/merchants/webhook", {
        method: "PUT",
        body: { webhookSecret: secret || null },
      });
      toast.success(secret ? "Signing secret saved" : "Signing secret removed");
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) setSecretError(err.message);
      else toast.error("Secret not saved", errorMessage(err));
    } finally {
      setSavingSecret(false);
    }
  };

  const generateSecret = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
    setSecretError(null);
  };

  const atLimit = (endpoints?.length ?? 0) >= max;

  return (
    <div className="frame">
    <div className="frame-inner p-5 sm:p-8 space-y-10">
      <div>
        <h2 className="text-[20px] font-heading font-semibold text-default-950 tracking-tight mb-1">
          Webhook endpoints
        </h2>
        <p className="text-[14px] text-default-500 font-body max-w-2xl">
          Add one endpoint per site. Each payment is sent to exactly one of them: the
          endpoint chosen for the API key or payment link it came from, otherwise your
          default endpoint. Running several sites? Give each site its own API key and
          point the key at that site&apos;s endpoint in{" "}
          <Link href="/dashboard/api-keys" className="font-semibold text-default-900 underline">
            API keys
          </Link>
          .{" "}
          <Link href="/docs#webhooks" className="font-semibold text-default-900 underline">
            How webhooks work
          </Link>
        </p>
      </div>

      {/* ENDPOINT LIST */}
      <div className="space-y-3">
        {endpoints && endpoints.length > 0 && !endpoints.some((e) => e.isDefault) && (
          <p role="alert" className="flex items-start gap-1.5 rounded-xl bg-accent-orange/10 px-4 py-3 text-[13px] text-default-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-accent-orange" />
            No default endpoint: payments that don&apos;t come through an API key or payment
            link with its own endpoint notify no site. Make one endpoint the default.
          </p>
        )}
        {loadFailed ? (
          <div className="flex items-center justify-between rounded-xl border border-accent-red/20 bg-accent-red/5 p-4 text-[14px] text-default-700">
            Couldn&apos;t load your endpoints.
            <button type="button" onClick={load} className="font-semibold underline cursor-pointer">
              Retry
            </button>
          </div>
        ) : endpoints === null ? (
          <div className="h-20 animate-pulse rounded-xl bg-default-100" />
        ) : endpoints.length === 0 ? (
          <div className="rounded-xl border border-dashed border-default-200 p-6 text-center text-[14px] text-default-500">
            No endpoints yet. Your sites won&apos;t hear about payments until you add one
            (or pass a <code className="font-mono">webhookUrl</code> when creating payments).
          </div>
        ) : (
          endpoints.map((ep) => (
            <div
              key={ep.id}
              className={cn(
                "rounded-xl border p-4",
                ep.health?.failing && ep.isActive
                  ? "border-accent-red/30 bg-accent-red/3"
                  : "border-default-200",
              )}
            >
              {editingId === ep.id ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
                    <input
                      aria-label="Label"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label (e.g. Main store)"
                      className={inputClass.replace("font-mono", "font-medium")}
                    />
                    <div>
                      <input
                        aria-label="Endpoint URL"
                        type="url"
                        value={editUrl}
                        onChange={(e) => {
                          setEditUrl(e.target.value);
                          setEditError(null);
                        }}
                        aria-invalid={!!editError}
                        className={cn(inputClass, editError && "border-accent-red")}
                      />
                      <FieldError message={editError} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="flex items-center gap-1.5 rounded-lg border border-default-200 px-3 py-2 text-[13px] font-semibold text-default-600 hover:bg-default-50 cursor-pointer"
                    >
                      <X size={14} /> Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(ep)}
                      disabled={busyId === ep.id || !editUrl.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-semibold text-white hover:bg-primary-deep disabled:opacity-50 cursor-pointer"
                    >
                      <Check size={14} /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Globe size={15} className="shrink-0 text-default-400" />
                      <span className="text-[14px] font-semibold text-default-900">
                        {ep.label || hostOf(ep.url)}
                      </span>
                      {ep.isDefault && (
                        <Pill className="bg-primary text-white">Default</Pill>
                      )}
                      <HealthPill endpoint={ep} />
                    </div>
                    <p className="break-all font-mono text-[12px] text-default-500">{ep.url}</p>
                    <p className="text-[12px] text-default-400">
                      {usage(ep)}
                      {ep.health &&
                        ` · ${ep.health.attempts - ep.health.failures} of ${ep.health.attempts} deliveries accepted in 7 days`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <IconButton
                      label="Send test event"
                      onClick={() => sendTest(ep)}
                      disabled={busyId === ep.id || !ep.isActive}
                    >
                      <Send size={14} /> Test
                    </IconButton>
                    {!ep.isDefault && (
                      <IconButton
                        label="Make this the default endpoint"
                        onClick={() => makeDefault(ep)}
                        disabled={busyId === ep.id}
                      >
                        Make default
                      </IconButton>
                    )}
                    <IconButton label="Edit endpoint" onClick={() => startEdit(ep)} disabled={busyId === ep.id}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label={ep.isActive ? "Pause endpoint" : "Resume endpoint"}
                      onClick={() => toggleActive(ep)}
                      disabled={busyId === ep.id}
                    >
                      {ep.isActive ? "Pause" : "Resume"}
                    </IconButton>
                    <IconButton
                      label="Delete endpoint"
                      onClick={() => remove(ep)}
                      disabled={busyId === ep.id}
                      danger
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ADD ENDPOINT */}
      <form onSubmit={addEndpoint} className="space-y-3 rounded-xl bg-default-50 p-5 border border-default-200">
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-heading font-semibold text-default-950">Add an endpoint</h3>
          <span className="text-[12px] text-default-400">
            {endpoints?.length ?? 0} of {max}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <div>
            <label htmlFor="wh-label" className={labelClass}>
              Label (optional)
            </label>
            <input
              id="wh-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Main store"
              maxLength={60}
              className={inputClass.replace("font-mono", "font-medium")}
            />
          </div>
          <div>
            <label htmlFor="wh-url" className={labelClass}>
              Endpoint URL
            </label>
            <input
              id="wh-url"
              type="url"
              required
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value);
                setAddError(null);
              }}
              placeholder="https://api.your-site.com/webhooks/crypteo"
              aria-invalid={!!addError}
              aria-describedby="wh-url-help"
              className={cn(inputClass, addError && "border-accent-red")}
            />
            <FieldError message={addError} />
            <p id="wh-url-help" className="mt-2 pl-1 text-[12px] text-default-400">
              A server route that accepts POST and answers 2xx, not a page of your website.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={adding || atLimit || !newUrl.trim()}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white shadow-aigocy-dark hover:bg-primary-deep disabled:opacity-50 cursor-pointer"
          >
            <Plus size={15} /> {atLimit ? `Limit of ${max} reached` : "Add endpoint"}
          </button>
        </div>
      </form>

      {/* SIGNING SECRET */}
      <div className="space-y-3 border-t border-default-100 pt-8">
        <div>
          <h3 className="text-[16px] font-heading font-semibold text-default-950">Signing secret</h3>
          <p className="text-[13px] text-default-500 max-w-2xl">
            Every delivery, to every endpoint, is signed with this secret: an HMAC-SHA256 of the
            raw body in the <code className="font-mono">X-Signature</code> header. Verify it before
            trusting an event. Use at least 16 characters.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Shield size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-default-400" />
            <SecretInput
              masking="css"
              revealLabel="signing secret"
              aria-label="Signing secret"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setSecretError(null);
              }}
              placeholder="Not set: deliveries are unsigned"
              aria-invalid={!!secretError}
              className={cn(inputClass, "pl-11", secretError && "border-accent-red")}
            />
          </div>
          {["Copy", "Generate"].map((label) => (
            <button
              key={label}
              type="button"
              onClick={label === "Copy" ? () => void copyWithToast(secret, "Signing secret copied") : generateSecret}
              disabled={label === "Copy" && !secret}
              className="rounded-xl border border-default-200 px-4 py-3 text-[13px] font-semibold text-default-700 hover:bg-default-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              {label}
            </button>
          ))}
          <ActionButton onClick={saveSecret} disabled={savingSecret} variant="primary" className="px-6 py-3">
            {savingSecret ? "Saving…" : "Save secret"}
          </ActionButton>
        </div>
        <FieldError message={secretError} />
      </div>
    </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 cursor-pointer",
        danger
          ? "border-accent-red/20 text-accent-red hover:bg-accent-red/5"
          : "border-default-200 text-default-700 hover:bg-default-50",
      )}
    >
      {children}
    </button>
  );
}

function usage(ep: Endpoint): string {
  const parts = [
    ep.isDefault ? "Default for payments with no other destination" : null,
    ep.apiKeys ? `${ep.apiKeys} API key${ep.apiKeys === 1 ? "" : "s"}` : null,
    ep.paymentLinks ? `${ep.paymentLinks} payment link${ep.paymentLinks === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not used yet: choose it on an API key or payment link";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
