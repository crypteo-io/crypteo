"use client";

import { ApiError, apiRequest } from "@/lib/api-client";
import { EndpointSelect, type EndpointOption } from "./EndpointSelect";
import { toast } from "@/lib/toast";
import { getChainMeta } from "@/components/ui/ChainIcon";
import {
    AlertCircle, AlertTriangle, ChevronDown, Link as LinkIcon, Save, Webhook
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { PageHeader } from "./PageHeader";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";

/** Where a link's payments send webhooks: "" = default endpoint, an endpoint id, or a custom URL. */
const CUSTOM_URL = "__custom__";

export function CreatePaymentLinkClient({
  availableWallets = [],
  webhookEndpoints = [],
}: {
  /** `problem`: why this pair's saved wallet can't be pinned (lib/payment/wallets.ts). */
  availableWallets?: { chain: string; token: string; problem?: string | null }[];
  webhookEndpoints?: EndpointOption[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Field-level errors are shown under the field they concern, where the
  // merchant is looking, not in the banner at the top of the form.
  const [pinError, setPinError] = useState<string | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookChoice, setWebhookChoice] = useState("");
  const [customWebhookUrl, setCustomWebhookUrl] = useState("");
  const pinRef = useRef<HTMLDivElement>(null);
  const webhookRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    amount: "10.00",
    chain: "",
    token: "",
    expiresAt: "never",
    paymentLimit: "never",
    customPaymentLimit: "",
  });

  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const currencyRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        currencyRef.current &&
        !currencyRef.current.contains(event.target as Node)
      ) {
        setCurrencyOpen(false);
      }
      if (
        networkRef.current &&
        !networkRef.current.contains(event.target as Node)
      ) {
        setNetworkOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const availableTokens = React.useMemo(() => {
    const tokens = new Set<string>();
    availableWallets.forEach((w) => tokens.add(w.token.toLowerCase()));
    return Array.from(tokens).map((t) => ({
      symbol: t,
      meta: getChainMeta(t),
    }));
  }, [availableWallets]);

  const availableNetworks = React.useMemo(() => {
    if (!formData.token) return [];
    return availableWallets
      .filter((w) => w.token.toLowerCase() === formData.token.toLowerCase())
      .map((w) => ({
        chain: w.chain.toLowerCase(),
        meta: getChainMeta(w.chain),
        problem: w.problem ?? null,
      }));
  }, [formData.token, availableWallets]);

  // The selected pair's saved wallet can't receive payments (e.g. a Solana
  // address saved as the XRP wallet): known before submitting.
  const selectedProblem =
    formData.chain && formData.token
      ? (availableWallets.find(
          (w) => w.chain === formData.chain && w.token === formData.token,
        )?.problem ?? null)
      : null;
  const needsNetwork = !!formData.token && !formData.chain;
  const pinMessage = selectedProblem ?? pinError;

  const webhookUrl = webhookChoice === CUSTOM_URL ? customWebhookUrl.trim() || null : null;
  const webhookEndpointId =
    webhookChoice && webhookChoice !== CUSTOM_URL ? webhookChoice : null;
  const defaultEndpoint = webhookEndpoints.find((e) => e.isDefault);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const showField = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPinError(null);
    setWebhookError(null);

    if (selectedProblem) {
      showField(pinRef);
      return;
    }
    if (needsNetwork) {
      setPinError(
        `Choose a network for ${formData.token.toUpperCase()}, or pick "Any Supported Currency".`,
      );
      showField(pinRef);
      return;
    }
    if (webhookChoice === CUSTOM_URL && !webhookUrl) {
      setWebhookError("Enter the URL this link's payments should be sent to.");
      showField(webhookRef);
      return;
    }

    let finalLimit = formData.paymentLimit;
    if (formData.paymentLimit === "custom") {
      finalLimit = formData.customPaymentLimit;
    }

    setLoading(true);
    try {
      await apiRequest("/api/payment-links", {
        method: "POST",
        body: {
          title: formData.title,
          description: formData.description,
          amount: formData.amount,
          chain: formData.chain,
          token: formData.token,
          expiresAt: formData.expiresAt,
          paymentLimit: finalLimit,
          webhookUrl,
          webhookEndpointId,
        },
      });

      toast.success("Payment link created", `"${formData.title}" is live. Copy it from the list to share.`);
      router.push("/dashboard/payment-links");
      router.refresh(); // refresh the server component data
    } catch (err: unknown) {
      if (err instanceof ApiError && err.field === "chain") {
        setPinError(err.message);
        showField(pinRef);
      } else if (err instanceof ApiError && err.field === "webhookUrl") {
        setWebhookError(err.message);
        showField(webhookRef);
      } else {
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-8">
      <PageHeader
        title="New payment link"
        subtitle="A reusable hosted checkout you can share with customers."
        backHref="/dashboard/payment-links"
        backLabel="Back to payment links"
      />

      <div className="frame">
      <div className="frame-inner">
        <form onSubmit={handleSubmit} className="p-5 sm:p-8 space-y-8">
          {error && (
            <div className="bg-accent-red/5 border border-accent-red/15 rounded-xl p-4 flex items-start gap-3 text-accent-red">
              <AlertTriangle size={20} className="shrink-0 mt-0.5" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {/* Core Info */}
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-default-900 flex items-center gap-2">
              <LinkIcon size={18} className="text-default-500" /> Basic
              Information
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                  Link Title *
                </label>
                <input
                  type="text"
                  name="title"
                  required
                  placeholder="e.g. Premium Subscription"
                  value={formData.title}
                  onChange={handleChange}
                  className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 focus:bg-white focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                  Amount (USD) *
                </label>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  required
                  min="0.01"
                  value={formData.amount}
                  onChange={handleChange}
                  className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 focus:bg-white focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                Description (Optional)
              </label>
              <textarea
                name="description"
                placeholder="Product details or instructions..."
                value={formData.description}
                onChange={handleChange}
                className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 h-24 resize-none focus:bg-white focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all"
              />
            </div>
          </div>

          <div className="h-px bg-default-200" />

          {/* Limits & Expiration */}
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-default-900">
              Limits & Expiration
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                  Payment Limit
                </label>
                <select
                  name="paymentLimit"
                  value={formData.paymentLimit}
                  onChange={handleChange}
                  className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 focus:bg-white focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all appearance-none cursor-pointer"
                >
                  <option value="never">Unlimited</option>
                  <option value="once">Single Use (1 payment)</option>
                  <option value="custom">Custom Limit</option>
                </select>

                {formData.paymentLimit === "custom" && (
                  <input
                    type="number"
                    name="customPaymentLimit"
                    placeholder="Enter max number of payments"
                    min="1"
                    required
                    value={formData.customPaymentLimit}
                    onChange={handleChange}
                    className="w-full mt-3 bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 focus:bg-white focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all"
                  />
                )}
              </div>

              <div>
                <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                  Expires In
                </label>
                <select
                  name="expiresAt"
                  value={formData.expiresAt}
                  onChange={handleChange}
                  className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 focus:bg-white focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all appearance-none cursor-pointer"
                >
                  <option value="never">Never (No expiration)</option>
                  <option value="1 day">24 Hours</option>
                  <option value="7 days">7 Days</option>
                  <option value="30 days">30 Days</option>
                  <option value="1 year">1 Year</option>
                </select>
              </div>
            </div>
          </div>

          <div className="h-px bg-default-200" />

          {/* Advanced / Specific Setup */}
          <div className="space-y-6" ref={pinRef}>
            <h2 className="text-lg font-semibold text-default-900">
              Advanced Setup (Optional)
            </h2>
            <p className="text-sm text-default-500">
              Leave these blank to let the customer select from any of your
              active wallets. To restrict this link to one currency and
              network, choose them here: payments go to your saved wallet for
              that network.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Currency Dropdown */}
              <div className="relative" ref={currencyRef}>
                <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                  Specific Currency
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setCurrencyOpen(!currencyOpen);
                    setNetworkOpen(false);
                  }}
                  className={`w-full flex items-center justify-between p-4 bg-white border ${
                    currencyOpen
                      ? "border-sky ring-4 ring-sky/10"
                      : "border-default-200 hover:border-default-300"
                  } rounded-xl transition-all cursor-pointer text-left`}
                >
                  <div className="flex items-center gap-3">
                    {formData.token ? (
                      <>
                        <Image
                          src={getChainMeta(formData.token).image}
                          alt="token"
                          width={24}
                          height={24}
                          className="rounded-full bg-default-100"
                        />
                        <span className="font-semibold text-[14px] text-default-900 uppercase">
                          {formData.token}
                        </span>
                      </>
                    ) : (
                      <span className="text-[14px] font-medium text-default-900">
                        Any Supported Currency
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    size={18}
                    className={`text-default-500 transition-transform ${currencyOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {currencyOpen && (
                  <div className="absolute z-50 mt-2 w-full bg-white border border-default-200 rounded-xl shadow-card-hover py-2 max-h-60 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setFormData((prev) => ({
                          ...prev,
                          token: "",
                          chain: "",
                        }));
                        setPinError(null);
                        setCurrencyOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-default-50 transition-colors text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-default-100 border border-default-200 flex items-center justify-center shrink-0" />
                      <span className="font-medium text-[14px] text-default-900">
                        Any Supported Currency
                      </span>
                    </button>
                    {availableTokens.map((t) => (
                      <button
                        key={t.symbol}
                        type="button"
                        onClick={() => {
                          setFormData((prev) => ({
                            ...prev,
                            token: t.symbol,
                            chain: "", // Reset chain when token changes
                          }));
                          setPinError(null);
                          setCurrencyOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-default-50 transition-colors text-left"
                      >
                        <Image
                          src={t.meta.image}
                          alt={t.symbol}
                          width={24}
                          height={24}
                          className="rounded-full bg-default-100 shrink-0"
                        />
                        <span className="font-semibold text-[14px] uppercase text-default-900">
                          {t.symbol}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Network Dropdown */}
              <div className="relative" ref={networkRef}>
                <label className="block text-[13px] font-medium text-default-700 mb-2 pl-1">
                  Specific Network
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (formData.token) {
                      setNetworkOpen(!networkOpen);
                      setCurrencyOpen(false);
                    }
                  }}
                  disabled={!formData.token}
                  aria-describedby={pinMessage ? "pin-error" : undefined}
                  className={`w-full flex items-center justify-between p-4 bg-white border ${
                    networkOpen
                      ? "border-sky ring-4 ring-sky/10"
                      : pinMessage
                        ? "border-accent-red"
                        : "border-default-200"
                  } rounded-xl transition-all ${
                    !formData.token
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-white cursor-pointer"
                  } text-left`}
                >
                  <div className="flex items-center gap-3">
                    {formData.chain ? (
                      <>
                        <Image
                          src={getChainMeta(formData.chain).image}
                          alt="network"
                          width={24}
                          height={24}
                          className="rounded-full bg-default-100"
                        />
                        <span className="font-semibold text-[14px] text-default-900 uppercase">
                          {getChainMeta(formData.chain).name}
                        </span>
                      </>
                    ) : (
                      <span className="text-[14px] font-medium text-default-900">
                        Select Network
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    size={18}
                    className={`text-default-500 transition-transform ${networkOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {networkOpen && (
                  <div className="absolute z-50 mt-2 w-full bg-white border border-default-200 rounded-xl shadow-card-hover py-2 max-h-60 overflow-y-auto">
                    {availableNetworks.map((n) => (
                      <button
                        key={n.chain}
                        type="button"
                        onClick={() => {
                          setFormData((prev) => ({
                            ...prev,
                            chain: n.chain,
                          }));
                          setPinError(null);
                          setNetworkOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-default-50 transition-colors text-left"
                      >
                        <Image
                          src={n.meta.image}
                          alt={n.meta.name}
                          width={24}
                          height={24}
                          className="rounded-full bg-default-100 shrink-0"
                        />
                        <span className="font-semibold text-[14px] uppercase text-default-900">
                          {n.meta.name}
                        </span>
                        {n.problem && (
                          <span className="ml-auto rounded-full bg-accent-red/10 px-2 py-0.5 text-[11px] font-semibold text-accent-red">
                            Invalid wallet
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {pinMessage && (
              <div
                id="pin-error"
                role="alert"
                className="-mt-3 flex items-start gap-2 rounded-xl border border-accent-red/20 bg-accent-red/5 px-4 py-3 text-[13px] text-accent-red"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  {pinMessage.replace(/[.\s]*$/, ".")}
                  {selectedProblem && (
                    <>
                      {" "}
                      This link can&apos;t be pinned to it until you{" "}
                      <Link href="/dashboard/wallets" className="font-semibold underline">
                        fix the address in Wallets
                      </Link>
                      , or choose another network.
                    </>
                  )}
                </span>
              </div>
            )}
          </div>

          <div className="h-px bg-default-100" />

          {/* Webhook destination */}
          <div className="space-y-4" ref={webhookRef}>
            <h2 className="text-lg font-semibold text-default-900 flex items-center gap-2">
              <Webhook size={18} className="text-default-400" /> Webhook
            </h2>
            <p className="text-sm text-default-500">
              Where this link&apos;s payment updates are sent. Each payment goes to one destination:
              pick the endpoint of the site that sells it.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label
                  htmlFor="link-webhook"
                  className="block text-[13px] font-medium text-default-700 mb-2 pl-1"
                >
                  Send updates to
                </label>
                <EndpointSelect
                  id="link-webhook"
                  value={webhookChoice}
                  onChange={(v) => {
                    setWebhookChoice(v);
                    setWebhookError(null);
                  }}
                  endpoints={webhookEndpoints}
                  extraOptions={<option value={CUSTOM_URL}>A custom URL…</option>}
                  className="w-full bg-white border border-default-200 rounded-xl px-4 py-3 text-[14px] font-medium text-default-900 focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all appearance-none cursor-pointer"
                />
                {webhookChoice === "" && !defaultEndpoint?.isActive && (
                  <p className="mt-2 pl-1 text-[12px] text-accent-orange">
                    {defaultEndpoint
                      ? "Your default endpoint is paused: payments through this link won't notify any site until you resume it."
                      : "You have no default endpoint: payments through this link won't notify any site."}{" "}
                    <Link href="/dashboard/settings?tab=webhooks" className="font-semibold underline">
                      Add one in Settings
                    </Link>
                  </p>
                )}
              </div>
              {webhookChoice === CUSTOM_URL && (
                <div>
                  <label
                    htmlFor="link-webhook-url"
                    className="block text-[13px] font-medium text-default-700 mb-2 pl-1"
                  >
                    Webhook URL
                  </label>
                  <input
                    id="link-webhook-url"
                    type="url"
                    value={customWebhookUrl}
                    onChange={(e) => {
                      setCustomWebhookUrl(e.target.value);
                      setWebhookError(null);
                    }}
                    placeholder="https://api.your-site.com/webhooks/crypteo"
                    aria-invalid={!!webhookError}
                    className={`w-full bg-white border ${webhookError ? "border-accent-red" : "border-default-200"} rounded-xl px-4 py-3 text-[14px] font-mono text-default-900 focus:outline-none focus:border-sky focus:ring-4 focus:ring-sky/10 transition-all`}
                  />
                </div>
              )}
            </div>
            {webhookError && (
              <p role="alert" className="flex items-start gap-1.5 pl-1 text-[13px] text-accent-red">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {webhookError}
              </p>
            )}
          </div>

          <div className="pt-6">
            <button
              type="submit"
              disabled={loading || !!selectedProblem}
              className="w-full bg-primary hover:bg-primary-deep disabled:bg-default-200 disabled:cursor-not-allowed text-white px-5 py-4 rounded-xl font-semibold transition-colors shadow-aigocy-dark flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save size={18} /> Create payment link
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
