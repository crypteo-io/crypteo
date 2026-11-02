"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { copyWithToast, errorMessage, toast } from "@/lib/toast";
import { LocalDate } from "@/components/ui/LocalDate";
import { cn } from "@/lib/utils";
import { ApiKey } from "@/types/payment";
import gsap from "gsap";
import {
    AlertTriangle,
    Calendar, CheckCircle, Clock, Copy, Globe, Key,
    Plus, XCircle
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ActionButton } from "./ActionButton";
import { EndpointSelect, type EndpointOption } from "./EndpointSelect";
import { PageHeader } from "./PageHeader";

// Using the global ApiKey interface from types/payment.ts

export function ApiKeysClient({
  apiKeys: initial,
  webhookEndpoints = [],
}: {
  apiKeys: ApiKey[];
  webhookEndpoints?: EndpointOption[];
}) {
  const [keys, setKeys] = useState(initial);
  const [endpointId, setEndpointId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const containerRef = useRef<HTMLDivElement>(null);
  const createSectionRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const items = el.querySelectorAll(".animate-up");
    gsap.set(items, { opacity: 1, y: 0 });
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".animate-up",
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.05,
          ease: "power2.out",
          clearProps: "all",
        },
      );
    }, containerRef);
    return () => ctx.revert();
  }, []);

  useLayoutEffect(() => {
    if (showCreate) {
      gsap.fromTo(
        createSectionRef.current,
        { height: 0, opacity: 0, marginTop: 0 },
        {
          height: "auto",
          opacity: 1,
          marginTop: 24,
          duration: 0.5,
          ease: "power3.out",
        },
      );
    } else {
      gsap.to(createSectionRef.current, {
        height: 0,
        opacity: 0,
        marginTop: 0,
        duration: 0.4,
        ease: "power3.in",
      });
    }
  }, [showCreate]);

  const createKey = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ rawKey: string; apiKey?: (typeof keys)[number] }>(
        "/api/api-keys",
        { method: "POST", body: { label, isTest, webhookEndpointId: endpointId || null } },
      );
      setNewKey(data.rawKey);
      if (data.apiKey) setKeys((prev) => [data.apiKey!, ...prev]);
      toast.success(
        isTest ? "Test key created" : "Live key created",
        "Copy it now: it won't be shown again.",
      );
    } catch (err) {
      setError(errorMessage(err, "Failed to create API key"));
    } finally {
      setLoading(false);
    }
  };

  const revokeKey = async (id: string) => {
    const key = keys.find((k) => k.id === id);
    const ok = await confirm({
      title: "Revoke this API key?",
      description: `Requests signed with ${key ? `${key.keyPrefix}…` : "this key"} are refused immediately, and any integration using it stops working. This can't be undone.`,
      confirmLabel: "Revoke key",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await toast.promise(apiRequest("/api/api-keys", { method: "DELETE", body: { id } }), {
        loading: "Revoking key…",
        success: "API key revoked",
        error: "Key not revoked",
      });
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, isActive: false } : k)));
    } catch {
      // The toast already says why; the key stays shown as active.
    }
  };

  // Applies to payments the key creates from now on.
  const setKeyEndpoint = async (id: string, value: string) => {
    const previous = keys.find((k) => k.id === id)?.webhookEndpointId ?? null;
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, webhookEndpointId: value || null } : k)));
    try {
      await toast.promise(
        apiRequest("/api/api-keys", {
          method: "PATCH",
          body: { id, webhookEndpointId: value || null },
        }),
        { loading: "Saving…", success: "Webhook destination updated", error: "Not updated" },
      );
    } catch {
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, webhookEndpointId: previous } : k)));
    }
  };

  const copy = async (text: string) => {
    if (await copyWithToast(text, "API key copied")) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div ref={containerRef} className="space-y-8 pb-12">
      <div className="animate-up">
        <PageHeader
          title="API keys"
          subtitle="Secret keys for your server. Live keys start with crypt_, test keys with test_."
          actions={
            <ActionButton
              onClick={() => {
                setShowCreate(!showCreate);
                setNewKey(null);
                setLabel("");
                setIsTest(false);
              }}
              variant="primary"
              className="px-4 py-2.5 text-[13px]"
              aria-expanded={showCreate}
            >
              <Plus
                size={16}
                className={cn("transition-transform duration-300", showCreate && "rotate-45")}
              />
              {showCreate ? "Close" : "New key"}
            </ActionButton>
          }
        />
      </div>

      {/* CREATE SECTION */}
      <div ref={createSectionRef} className="overflow-hidden opacity-0 h-0">
        <div className="frame">
        <div className="frame-inner p-5 sm:p-8">
          {newKey ? (
            <div className="space-y-6">
              <div className="flex items-start gap-4 p-5 bg-accent-orange/5 border border-accent-orange/15 rounded-xl">
                <AlertTriangle
                  className="text-accent-orange shrink-0 mt-0.5"
                  size={20}
                />
                <div>
                  <h4 className="text-[14px] font-semibold text-default-900 mb-1">
                    Save your Secret Key
                  </h4>
                  <p className="text-[13px] text-default-500 leading-relaxed">
                    This key will only be shown <strong>once</strong>. If you
                    lose it, you&apos;ll need to generate a new one. Store it
                    securely in your environment variables.
                  </p>
                </div>
              </div>

              <div className="group relative flex items-center bg-default-950 rounded-xl p-4 sm:p-5 border border-default-900">
                <code className="flex-1 font-mono text-[14px] text-white/90 break-all select-all tracking-wider">
                  {newKey}
                </code>
                <button
                  onClick={() => copy(newKey)}
                  className="ml-4 p-3 bg-white/5 hover:bg-white/10 rounded-xl text-white/50 hover:text-white transition-all active:scale-95"
                >
                  {copied ? (
                    <CheckCircle size={18} className="text-accent-green" />
                  ) : (
                    <Copy size={18} />
                  )}
                </button>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-8 py-3 bg-primary text-white font-semibold text-[14px] rounded-xl hover:bg-primary-deep shadow-aigocy-dark transition-colors"
                >
                  I Have Saved the Key
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-xl mx-auto space-y-8 py-4">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 icon-tile mx-auto mb-4 text-sky">
                  <Key size={32} />
                </div>
                <h2 className="text-[22px] font-heading font-semibold text-default-950">
                  New API Key
                </h2>
                <p className="text-[14px] text-default-500">
                  Provide a label to help you identify where this key is being
                  used.
                </p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[13px] font-medium text-default-700 pl-1">
                    Identifying Label (e.g. &quot;Main Production&quot;)
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Provide a name for this key..."
                    className="w-full bg-white border border-default-200 rounded-xl px-5 py-3.5 text-[14px] font-medium text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isTestToggle"
                    checked={isTest}
                    onChange={(e) => setIsTest(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary focus:ring-sky border-default-300"
                  />
                  <label
                    htmlFor="isTestToggle"
                    className="text-[14px] font-medium text-default-700"
                  >
                    Generate as{" "}
                    <span className="font-semibold text-accent-orange">
                      Test Key
                    </span>{" "}
                    (Used for playground and simulation ONLY)
                  </label>
                </div>

                {!isTest && (
                  <div className="space-y-2">
                    <label
                      htmlFor="key-endpoint"
                      className="text-[13px] font-medium text-default-700 pl-1"
                    >
                      Send this key&apos;s payment webhooks to
                    </label>
                    <EndpointSelect
                      id="key-endpoint"
                      value={endpointId}
                      onChange={setEndpointId}
                      endpoints={webhookEndpoints}
                      className="w-full bg-white border border-default-200 rounded-xl px-5 py-3.5 text-[14px] font-medium text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all cursor-pointer"
                    />
                    <p className="pl-1 text-[12px] text-default-500">
                      Running several sites? Create one key per site and point each at
                      its own endpoint, so every site only hears about its own payments.
                      A <code className="font-mono">webhookUrl</code> sent with a payment
                      still takes priority.{" "}
                      <Link href="/dashboard/settings?tab=webhooks" className="font-semibold underline">
                        Manage endpoints
                      </Link>
                    </p>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 p-4 bg-accent-red/5 border border-accent-red/15 rounded-xl text-accent-red text-[13px] font-medium animate-in fade-in slide-in-from-top-1">
                    <XCircle size={16} />
                    {error}
                  </div>
                )}

                <div className="flex gap-4">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="flex-1 py-4 text-[14px] font-semibold text-default-500 hover:text-default-900 transition-colors"
                  >
                    Cancel
                  </button>
                  <ActionButton
                    variant="primary"
                    className="flex-1 py-4 text-[14px] font-semibold"
                    onClick={createKey}
                    disabled={loading}
                  >
                    {loading ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto block" />
                    ) : (
                      "Generate API Key"
                    )}{" "}
                  </ActionButton>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* KEYS LIST */}
      <div className="frame animate-up">
        <div className="frame-inner overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-default-200 px-5 py-4 sm:px-6">
          <span className="size-2 rounded-full bg-sky" aria-hidden />
          <h2 className="font-heading text-[16px] font-semibold text-default-950">Your keys</h2>
          <span className="rounded-md bg-default-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-default-600">
            {keys.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left stack-table">
            <thead>
              <tr className="border-b border-default-200 bg-default-50">
                <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">
                  Label
                </th>
                <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">
                  Key
                </th>
                <th className="hidden xl:table-cell px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">
                  Created
                </th>
                <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">
                  Last used
                </th>
                <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">
                  Status
                </th>
                <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default-100">
              {keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 icon-tile mb-4 text-default-400">
                        <Key size={32} />
                      </div>
                      <p className="text-default-500 font-medium">
                        You haven&apos;t generated any API keys yet.
                      </p>
                      <button
                        onClick={() => setShowCreate(true)}
                        className="mt-4 text-[13px] font-semibold text-sky hover:underline"
                      >
                        Create your first key
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                keys
                  .filter((k) => k !== undefined && k !== null)
                  .map((k) => (
                    <tr
                      key={k.id}
                      className="hover:bg-default-50 transition-colors group"
                    >
                      <td className="px-5 sm:px-6 py-4">
                        <span className="text-[14px] font-semibold text-default-900">
                          {k.label || "Untitled key"}
                        </span>
                        {k.isActive && !k.isTest && (
                          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-default-500">
                            <span className="shrink-0">Webhooks to</span>
                            <EndpointSelect
                              value={k.webhookEndpointId ?? ""}
                              onChange={(v) => setKeyEndpoint(k.id, v)}
                              endpoints={webhookEndpoints}
                              className="max-w-[240px] truncate rounded-lg border border-default-200 bg-white px-2 py-1 text-[12px] text-default-700 cursor-pointer"
                            />
                          </label>
                        )}
                      </td>
                      <td data-label="Key" className="px-5 sm:px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-default-100 border border-default-200 rounded text-[11px] font-mono font-semibold text-default-500 uppercase tracking-wider">
                            {k.keyPrefix}…
                          </span>
                          {k.isTest && (
                            <span className="px-2 py-1 bg-accent-orange/10 text-accent-orange border border-accent-orange/20 rounded text-[10px] font-semibold uppercase tracking-wider leading-none">
                              Test
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-label="Created" className="hidden xl:table-cell px-5 sm:px-6 py-4">
                        <div className="flex items-center gap-2 text-default-500 text-[13px] font-medium">
                          <Calendar size={14} className="text-default-400" />
                          <LocalDate
                            value={k.createdAt}
                            options={{ month: "short", day: "numeric", year: "numeric" }}
                          />
                        </div>
                      </td>
                      <td data-label="Last used" className="px-5 sm:px-6 py-4">
                        <div className="flex items-center gap-2 text-default-500 text-[13px] font-medium">
                          <Clock size={14} className="text-default-400" />
                          {k.lastUsedAt ? (
                            <LocalDate
                              value={k.lastUsedAt}
                              options={{
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }}
                            />
                          ) : (
                            "Never"
                          )}
                        </div>
                      </td>
                      <td data-label="Status" className="px-5 sm:px-6 py-4">
                        <span
                          className={cn(
                            "inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-pill border",
                            k.isActive
                              ? "bg-accent-green/5 text-accent-green border-accent-green/15"
                              : "bg-accent-red/5 text-accent-red border-accent-red/15",
                          )}
                        >
                          {k.isActive ? "Active" : "Revoked"}
                        </span>
                      </td>
                      <td data-actions className="px-5 sm:px-6 py-4 text-right">
                        {k.isActive && (
                          <ActionButton
                            variant="secondary"
                            className="px-4 py-2 text-[13px] text-accent-red hover:bg-accent-red/5 hover:border-accent-red/20"
                            onClick={() => revokeKey(k.id)}
                          >
                            Revoke Key
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      {/* HELP CARD */}
      <div className="animate-up frame">
        <div className="frame-inner p-5 sm:p-7 flex flex-col sm:flex-row gap-5 sm:gap-6 sm:items-center">
          <div className="icon-tile size-14 shrink-0 text-sky">
            <Globe size={24} />
          </div>
          <div className="flex-1">
            <h4 className="text-[17px] font-heading font-semibold text-default-950 mb-2 tracking-tight">
              Need help with integration?
            </h4>
            <p className="text-[14px] text-default-600 leading-relaxed max-w-2xl font-body">
              Our developer documentation covers everything from basic Node.js
              implementation to complex webhook handling. Check our API
              Reference for detailed endpoint descriptions.
            </p>
          </div>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-primary text-white font-semibold text-[13px] rounded-xl hover:bg-primary-deep transition-colors flex items-center justify-center shrink-0"

          >
            Read Documentation
          </a>
        </div>
      </div>
    </div>
  );
}
