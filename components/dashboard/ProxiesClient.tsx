"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { SECRET_FIELD, SecretInput } from "@/components/ui/SecretInput";
import { ApiError, apiRequest } from "@/lib/api-client";
import type { ProxyScan } from "@/lib/proxy-health";
import type { ProxyView } from "@/lib/proxy-settings";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  Plus,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { ActionButton } from "./ActionButton";
import { PageHeader } from "./PageHeader";
import { RelativeTime } from "./RelativeTime";

type FieldErrors = Partial<Record<"url" | "label", string>>;

function fieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiError &&
    (error.field === "url" || error.field === "label")
    ? { [error.field]: error.message }
    : {};
}

export function ProxiesClient({
  initial,
  storageAvailable,
}: {
  initial: ProxyView[];
  storageAvailable: boolean;
}) {
  const [proxies, setProxies] = useState(initial);
  const [checking, setChecking] = useState(false);
  const active = proxies.filter((p) => p.isActive).length;
  const failing = proxies.filter((p) => p.health.failing).length;

  const checkNow = async () => {
    setChecking(true);
    try {
      const { scan, proxies: next } = await apiRequest<{ scan: ProxyScan; proxies: ProxyView[] }>(
        "/api/admin/proxies/check",
        { method: "POST" },
      );
      setProxies(next);
      if (scan.inconclusive) {
        toast.warning(
          "Check skipped",
          "The test requests failed without a proxy too, so the result would say nothing about the proxies. Nothing was recorded.",
        );
      } else {
        const passed = next.filter((p) => p.health.checkedAt && p.health.consecutiveFailures === 0).length;
        const failing = next.filter((p) => p.health.failing).length;
        toast.success(
          "Health check finished",
          `${passed} of ${scan.checked} passed${failing ? `, ${failing} flagged as failing` : ""}.`,
        );
      }
    } catch (error) {
      toast.error("Health check failed", errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-8 pb-4">
      <PageHeader
        title="Proxies"
        subtitle={`Outbound proxies for chain and price reads, ${active} of ${proxies.length} in use. Changes apply to the app at once and to the payment worker within a minute. A read that fails through a proxy is retried direct.`}
        actions={
          <ActionButton
            type="button"
            variant="outline"
            onClick={checkNow}
            disabled={checking || proxies.length === 0}
          >
            <Activity size={16} /> {checking ? "Checking…" : "Check now"}
          </ActionButton>
        }
      />

      {failing > 0 && (
        <p
          role="alert"
          className="flex gap-3 rounded-2xl border border-accent-red/20 bg-white/90 p-5 text-[14px] text-default-700"
        >
          <AlertTriangle size={20} className="shrink-0 text-accent-red" />
          {failing === 1 ? "1 proxy is" : `${failing} proxies are`} failing
          health checks. Reads through a failing proxy fall back to a direct
          connection: fix the address or pause the proxy.
        </p>
      )}

      {!storageAvailable && (
        <p
          role="alert"
          className="flex gap-3 rounded-2xl border border-accent-red/20 bg-white/90 p-5 text-[14px] text-default-700"
        >
          <AlertTriangle size={20} className="shrink-0 text-accent-red" />
          Proxies can&apos;t be saved: TWO_FACTOR_ENCRYPTION_KEY isn&apos;t set
          on this server, and proxy URLs are stored encrypted under it.
        </p>
      )}

      <AddProxy
        disabled={!storageAvailable}
        onAdded={(p) => setProxies((list) => [...list, p])}
      />

      <section className="frame">
        <div className="frame-inner">
          <div className="px-5 pt-5 md:px-7 md:pt-7">
            <h2 className="text-[20px]">Saved proxies</h2>
            <p className="mt-1 text-[14px] text-default-500">
              Every 5 minutes each one carries a real price request and a chain
              RPC call, checked against the same requests sent direct. Three
              failures in a row flag it and alert admins by email and in the
              dashboard, at most once every 6 hours per proxy.
            </p>
          </div>
          {proxies.length === 0 ? (
            <p className="px-5 pt-3 pb-7 text-[14px] text-default-500 md:px-7">
              No proxies: every chain and price read goes direct.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-default-100">
              {proxies.map((p) => (
                <ProxyRow
                  key={p.id}
                  proxy={p}
                  storageAvailable={storageAvailable}
                  onSaved={(next) =>
                    setProxies((list) =>
                      list.map((x) => (x.id === next.id ? next : x)),
                    )
                  }
                  onDeleted={() =>
                    setProxies((list) => list.filter((x) => x.id !== p.id))
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function AddProxy({
  disabled,
  onAdded,
}: {
  disabled: boolean;
  onAdded: (p: ProxyView) => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const { proxy } = await toast.promise(
        apiRequest<{ proxy: ProxyView }>("/api/admin/proxies", {
          method: "POST",
          body: { url, label },
        }),
        {
          loading: "Adding proxy…",
          success: "Proxy added",
          error: "Proxy not added",
        },
      );
      onAdded(proxy);
      setUrl("");
      setLabel("");
    } catch (error) {
      setErrors(fieldErrors(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="frame">
      <form
        onSubmit={add}
        className="frame-inner grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-start md:p-7"
      >
        <div>
          <label
            htmlFor="proxy-new-url"
            className="mb-2 block text-[14px] font-medium text-default-900"
          >
            Proxy URL
          </label>
          <SecretInput
            masking="css"
            id="proxy-new-url"
            revealLabel="proxy URL"
            placeholder="http://user:pass@host:port"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={disabled || busy}
            aria-invalid={!!errors.url}
            aria-describedby={errors.url ? "proxy-new-url-error" : undefined}
          />
          {errors.url && (
            <p
              id="proxy-new-url-error"
              className="mt-1.5 text-[13px] text-accent-red"
            >
              {errors.url}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="proxy-new-label"
            className="mb-2 block text-[14px] font-medium text-default-900"
          >
            Label{" "}
            <span className="font-normal text-default-500">(optional)</span>
          </label>
          <input
            id="proxy-new-label"
            className={cn(SECRET_FIELD, "font-body")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={disabled || busy}
            placeholder="Provider, region"
          />
          {errors.label && (
            <p className="mt-1.5 text-[13px] text-accent-red">{errors.label}</p>
          )}
        </div>
        <ActionButton
          type="submit"
          disabled={disabled || busy || !url.trim()}
          className="md:mt-7.5"
        >
          <Plus size={16} /> Add proxy
        </ActionButton>
      </form>
    </section>
  );
}

function ProxyRow({
  proxy,
  storageAvailable,
  onSaved,
  onDeleted,
}: {
  proxy: ProxyView;
  storageAvailable: boolean;
  onSaved: (p: ProxyView) => void;
  onDeleted: () => void;
}) {
  const confirm = useConfirm();
  const [url, setUrl] = useState(proxy.url ?? "");
  const [label, setLabel] = useState(proxy.label ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const urlChanged = url.trim() !== (proxy.url ?? "");
  const labelChanged = label.trim() !== (proxy.label ?? "");
  const unreadable = proxy.url === null;

  const patch = async (
    body: Record<string, unknown>,
    messages: { loading: string; success: string; error: string },
  ) => {
    setBusy(true);
    setErrors({});
    try {
      const { proxy: next } = await toast.promise(
        apiRequest<{ proxy: ProxyView }>(`/api/admin/proxies/${proxy.id}`, {
          method: "PATCH",
          body,
        }),
        messages,
      );
      onSaved(next);
      setUrl(next.url ?? "");
      setLabel(next.label ?? "");
    } catch (error) {
      setErrors(fieldErrors(error));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    patch(
      { ...(urlChanged ? { url } : {}), ...(labelChanged ? { label } : {}) },
      {
        loading: "Saving proxy…",
        success: "Proxy saved",
        error: "Proxy not saved",
      },
    );

  const toggle = () =>
    patch(
      { isActive: !proxy.isActive },
      proxy.isActive
        ? {
            loading: "Pausing proxy…",
            success: "Proxy paused",
            error: "Proxy not paused",
          }
        : {
            loading: "Resuming proxy…",
            success: "Proxy in use again",
            error: "Proxy not resumed",
          },
    );

  const remove = async () => {
    const ok = await confirm({
      title: "Delete this proxy?",
      description: `${proxy.host ?? "This proxy"} stops being used straight away. Pause it instead to keep it for later.`,
      confirmLabel: "Delete proxy",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await toast.promise(
        apiRequest(`/api/admin/proxies/${proxy.id}`, { method: "DELETE" }),
        {
          loading: "Deleting proxy…",
          success: "Proxy deleted",
          error: "Proxy not deleted",
        },
      );
      onDeleted();
    } catch {
      setBusy(false);
    }
  };

  return (
    <li className="px-5 py-5 md:px-7">
      <div className="mb-3">
        <div className="mb-1 flex items-center gap-2 text-[13px] text-default-500">
          <Server size={14} className="shrink-0" />
          <span className="truncate font-mono">
            {proxy.host ?? "Unreadable"}
          </span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              proxy.isActive
                ? "bg-sky/10 text-sky"
                : "bg-default-100 text-default-500",
            )}
          >
            {proxy.isActive ? "In use" : "Paused"}
          </span>
        </div>
        <HealthLine health={proxy.health} />
      </div>
      {/* One row, top-aligned: the URL, its label and the actions sit level. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-start">
        <div className="min-w-0">
          <SecretInput
            masking="css"
            aria-label={`Proxy URL for ${proxy.host ?? "this proxy"}`}
            revealLabel="proxy URL"
            value={url}
            placeholder={
              unreadable
                ? "Can't be read with this server's key: enter it again"
                : undefined
            }
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy || !storageAvailable}
            aria-invalid={!!errors.url}
          />
          {errors.url && (
            <p className="mt-1.5 text-[13px] text-accent-red">{errors.url}</p>
          )}
        </div>
        <div>
          <input
            aria-label="Label"
            className={cn(SECRET_FIELD, "font-body")}
            value={label}
            placeholder="Label"
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
          {errors.label && (
            <p className="mt-1.5 text-[13px] text-accent-red">{errors.label}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            type="button"
            onClick={save}
            disabled={busy || (!urlChanged && !labelChanged) || !url.trim()}
            className="px-4"
          >
            <Save size={15} /> Save
          </ActionButton>
          <ActionButton
            type="button"
            variant="outline"
            onClick={toggle}
            disabled={busy || unreadable}
            className="px-4"
          >
            {proxy.isActive ? "Pause" : "Resume"}
          </ActionButton>
          <ActionButton
            type="button"
            variant="ghost"
            onClick={remove}
            disabled={busy}
            aria-label={`Delete ${proxy.host ?? "proxy"}`}
            className="px-3 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={16} />
          </ActionButton>
        </div>
      </div>
    </li>
  );
}

function HealthLine({ health }: { health: ProxyView["health"] }) {
  if (!health.checkedAt) {
    return (
      <p className="text-[13px] text-default-500">
        Not checked yet: the first check runs within 5 minutes.
      </p>
    );
  }
  if (health.consecutiveFailures === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-accent-green">
        <span className="size-2 rounded-full bg-accent-green" aria-hidden />
        Healthy{health.latencyMs !== null && `, ${health.latencyMs} ms`} ·
        checked <RelativeTime value={health.checkedAt} />
      </p>
    );
  }
  return (
    <p
      className={cn(
        "text-[13px]",
        health.failing ? "text-accent-red" : "text-accent-orange",
      )}
    >
      <span className="font-semibold">
        {health.failing ? "Failing" : "Failed last check"} (
        {health.consecutiveFailures} in a row)
      </span>
      {health.error && <>: {health.error}</>} · last OK{" "}
      {health.okAt ? <RelativeTime value={health.okAt} /> : "never"}
    </p>
  );
}
