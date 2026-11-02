"use client";

import { CodeBlock } from "@/components/docs/CodeBlock";
import { Button } from "@/components/site/Button";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Play, Rocket, Terminal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function PlaygroundClient({
  sandboxKey = "",
}: {
  // Shared public test key, or "" when the sandbox isn't configured.
  sandboxKey?: string;
}) {
  const [apiKey, setApiKey] = useState(sandboxKey);
  // The sandbox counts as unavailable when no key is configured, or once the
  // API rejects the configured one (revoked/rotated) — in both cases the
  // visitor needs their own key, and the page should say so instead of
  // replaying requests that can only 401.
  const [sandboxRejected, setSandboxRejected] = useState(false);
  const sandboxUnavailable = !sandboxKey || sandboxRejected;
  const [amount, setAmount] = useState("10.00");
  const [customerEmail, setCustomerEmail] = useState("");
  const [externalId, setExternalId] = useState("");
  const [chain, setChain] = useState("");
  const [token, setToken] = useState("");

  const [requestHeaders, setRequestHeaders] = useState<string>("");
  const [requestBody, setRequestBody] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const predefinedNetworks = [
    { chain: "eth", token: "usdc" },
    { chain: "eth", token: "usdt" },
    { chain: "sol", token: "usdc" },
    { chain: "sol", token: "usdt" },
    { chain: "bsc", token: "usdt" },
    { chain: "polygon", token: "usdc" },
    { chain: "tron", token: "usdt" },
  ];

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey) {
      setResponse(JSON.stringify({ error: "API Key is required" }, null, 2));
      return;
    }

    setLoading(true);
    setCheckoutUrl(null);
    setResponse("Sending request...");

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    };

    const body = {
      amount: parseFloat(amount),
      customerEmail: customerEmail || undefined,
      externalId: externalId || undefined,
      chain: chain || undefined,
      token: token || undefined,
    };

    setRequestHeaders(JSON.stringify(headers, null, 2));
    setRequestBody(JSON.stringify(body, null, 2));

    try {
      const res = await fetch("/api/public/v1/payments", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      // An error page (proxy, crash) may not be JSON; show its status rather
      // than a parse error.
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setResponse(JSON.stringify(data, null, 2));

      if (res.status === 401 && sandboxKey && apiKey === sandboxKey) {
        // The shared key was revoked. Clear it so the form waits for the
        // visitor's own key rather than resubmitting a dead one.
        setSandboxRejected(true);
        setApiKey("");
      }

      if (res.ok && data.payment?.checkoutUrl) {
        setCheckoutUrl(data.payment.checkoutUrl);
      }
    } catch (err: unknown) {
      setResponse(
        JSON.stringify({ error: err instanceof Error ? err.message : "Network error" }, null, 2),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SiteShell>
      <PageHero
        eyebrow={<span className="eyebrow">Sandbox · test mode</span>}
        title="API playground"
        subtitle="Create a test payment session against the real API and open its hosted checkout. Test sessions never touch a blockchain."
      />

      <section className="pb-20 md:pb-28">
        <div className="container-site">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
            {/* Request form */}
            <div className="frame lg:col-span-5">
              <div className="frame-inner p-6 md:p-8">
                <h2 className="mb-6 flex items-center gap-3 text-xl md:text-[22px]">
                  <span className="icon-tile size-10">
                    <Terminal size={18} />
                  </span>
                  Configure request
                </h2>

                <form onSubmit={handleCreatePayment} className="space-y-5">
                  <div>
                    <label htmlFor="pg-key" className={LABEL}>
                      API key <span className="text-default-400">*</span>
                    </label>
                    <input
                      id="pg-key"
                      type="password"
                      required
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="field font-mono text-sm"
                      placeholder="crypt_... or test_..."
                    />
                    {sandboxUnavailable ? (
                      <div
                        role="status"
                        className="mt-2.5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-800"
                      >
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                        <p>
                          The public sandbox is temporarily unavailable.{" "}
                          <Link
                            href="/register"
                            className="font-semibold underline underline-offset-2"
                          >
                            create a free account
                          </Link>{" "}
                          to get your own test key, then paste it above.
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-[13px] text-default-500">
                        A public test key is pre-loaded. Swap it for your own key from the{" "}
                        <a
                          href="/dashboard/api-keys"
                          className="text-sky underline underline-offset-2"
                        >
                          dashboard
                        </a>{" "}
                        to test with your merchant account.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="pg-amount" className={LABEL}>
                        Amount (USD)
                      </label>
                      <input
                        id="pg-amount"
                        type="number"
                        step="0.01"
                        required
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="field"
                      />
                    </div>
                    <div>
                      <label htmlFor="pg-external" className={LABEL}>
                        External ID
                      </label>
                      <input
                        id="pg-external"
                        type="text"
                        value={externalId}
                        onChange={(e) => setExternalId(e.target.value)}
                        className="field"
                        placeholder="order_12345"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="pg-email" className={LABEL}>
                      Customer email
                    </label>
                    <input
                      id="pg-email"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="field"
                      placeholder="john@example.com"
                    />
                  </div>

                  <fieldset>
                    <legend className={LABEL}>Pre-select network (optional)</legend>
                    <div className="flex flex-wrap gap-2">
                      {predefinedNetworks.map((net) => {
                        const isSelected = chain === net.chain && token === net.token;
                        return (
                          <button
                            key={`${net.chain}-${net.token}`}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => {
                              if (isSelected) {
                                setChain("");
                                setToken("");
                              } else {
                                setChain(net.chain);
                                setToken(net.token);
                              }
                            }}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase transition-colors",
                              isSelected
                                ? "border-primary bg-primary text-white"
                                : "border-default-200 bg-white text-default-600 hover:border-default-300 hover:text-default-950",
                            )}
                          >
                            {net.token} on {net.chain}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[13px] text-default-500">
                      With a network the amount is in that token; without one it is USD and the
                      buyer picks at checkout.
                    </p>
                  </fieldset>

                  <Button
                    type="submit"
                    disabled={loading || !apiKey}
                    className="w-full"
                    icon={
                      loading ? (
                        <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : (
                        <Play size={15} className="fill-current" />
                      )
                    }
                  >
                    {loading ? "Sending..." : "Execute request"}
                  </Button>
                </form>
              </div>
            </div>

            {/* Request / response console */}
            <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
              <div className="frame flex-1">
                <div className="frame-inner flex h-full min-h-100 flex-col p-4 md:p-6">
                  <div className="mb-4 flex min-w-0 items-center gap-3 rounded-xl border border-default-200 bg-default-50 px-4 py-3">
                    <span className="inline-flex shrink-0 rounded-md bg-primary px-2 py-0.5 font-mono text-xs font-semibold text-white">
                      POST
                    </span>
                    <code className="truncate font-mono text-sm text-default-900">
                      /api/public/v1/payments
                    </code>
                  </div>

                  {!requestBody && !response ? (
                    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-default-200 p-8 text-center text-sm text-default-500">
                      Configure and execute a request to see the output here.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {requestBody && (
                        <CodeBlock
                          title="Request headers & body"
                          code={`${requestHeaders}\n\n${requestBody}`}
                        />
                      )}
                      {response && <CodeBlock title="Response" tone="response" code={response} />}
                    </div>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {checkoutUrl && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="frame"
                  >
                    <div className="frame-inner flex flex-col items-start justify-between gap-5 p-6 md:flex-row md:items-center md:p-7">
                      <div className="flex items-center gap-4">
                        <span className="icon-tile size-12">
                          <Rocket size={22} className="text-sky" />
                        </span>
                        <div>
                          <h3 className="text-lg">Payment session ready</h3>
                          <p className="mt-1 max-w-sm text-sm text-default-600">
                            Open the hosted checkout. For a test session, its simulate button
                            confirms the payment.
                          </p>
                        </div>
                      </div>
                      <a
                        href={checkoutUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-primary-deep md:w-auto"
                      >
                        Launch checkout <ArrowRight size={16} />
                      </a>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <p className="text-sm text-default-500">
                Every field is documented in the{" "}
                <Link href="/docs#create-payment" className="text-sky hover:underline">
                  API reference
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

const LABEL = "mb-2 block text-sm font-medium text-default-700";
