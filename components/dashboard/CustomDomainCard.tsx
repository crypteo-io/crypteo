"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { copyWithToast, errorMessage, toast } from "@/lib/toast";
import { CheckCircle2, Copy, Globe, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "./ActionButton";

export interface CustomDomainState {
  domain: string | null;
  /** TXT value to publish, while unverified. */
  txtValue: string | null;
  txtName: string | null;
  verified: boolean;
}

/** Payment links on the merchant's own subdomain: add, prove with TXT, point with CNAME. */
export function CustomDomainCard({ initial, cnameTarget }: { initial: CustomDomainState; cnameTarget: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      await apiRequest("/api/merchants/custom-domain", { method: "PUT", body: { domain: draft } });
      setDraft("");
    });

  const verify = () =>
    run(async () => {
      await apiRequest("/api/merchants/custom-domain/verify", { method: "POST" });
      toast.success("Domain connected", "Your payment links now use it.");
    });

  const remove = async () => {
    const ok = await confirm({
      title: `Disconnect ${initial.domain}?`,
      description: "Links shared on it stop opening. Your links keep working on crypteo.io.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (ok) await run(() => apiRequest("/api/merchants/custom-domain", { method: "DELETE" }));
  };

  const records = initial.domain && !initial.verified && initial.txtName && initial.txtValue
    ? [
        { type: "TXT", name: initial.txtName, value: initial.txtValue },
        { type: "CNAME", name: initial.domain, value: cnameTarget },
      ]
    : [];

  return (
    <section className="frame">
      <div className="frame-inner p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="icon-tile size-10 shrink-0">
              <Globe size={18} />
            </span>
            <div>
              <h2 className="font-heading text-[17px] font-semibold text-default-950">Your own domain</h2>
              <p className="mt-0.5 text-[14px] text-default-500">
                {initial.verified
                  ? "Your payment links open on your domain, with your branding."
                  : "Serve your payment links from a subdomain you own, such as pay.yourstore.com."}
              </p>
            </div>
          </div>
          {initial.domain && (
            <ActionButton type="button" variant="ghost" className="px-3 py-2 hover:text-accent-red" disabled={busy} onClick={remove}>
              <Trash2 size={15} /> Disconnect
            </ActionButton>
          )}
        </div>

        {!initial.domain && (
          <form
            className="mt-5 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <input
              className="field flex-1"
              placeholder="pay.yourstore.com"
              aria-label="Your subdomain"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            <ActionButton type="submit" disabled={busy || !draft.trim()} className="px-5 py-3">
              Connect
            </ActionButton>
          </form>
        )}

        {initial.verified && initial.domain && (
          <p className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-green/10 px-3.5 py-2 text-[14px] font-medium text-accent-green">
            <CheckCircle2 size={16} /> Live on https://{initial.domain}
          </p>
        )}

        {records.length > 0 && (
          <div className="mt-5 space-y-3">
            <p className="text-[14px] text-default-600">
              Add these two records at your DNS provider, then check. If your DNS is on Cloudflare, leave the CNAME
              unproxied (grey cloud).
            </p>
            <div className="overflow-hidden rounded-xl border border-default-200">
              {records.map((r) => (
                <div key={r.type} className="grid gap-1 border-b border-default-100 p-3.5 last:border-0 sm:grid-cols-[70px_1fr_1fr] sm:items-center sm:gap-3">
                  <span className="text-[12px] font-semibold tracking-wide text-default-500">{r.type}</span>
                  <DnsValue value={r.name} />
                  <DnsValue value={r.value} />
                </div>
              ))}
            </div>
            <ActionButton type="button" onClick={verify} disabled={busy} className="px-5 py-3">
              <RefreshCw size={15} className={busy ? "animate-spin" : undefined} /> Check DNS
            </ActionButton>
          </div>
        )}

        {error && <p className="mt-3 text-[13px] text-accent-red">{error}</p>}
      </div>
    </section>
  );
}

function DnsValue({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => void copyWithToast(value, "Copied")}
      className="group flex min-w-0 items-center gap-2 text-left font-mono text-[12.5px] leading-snug text-default-900"
    >
      <span className="break-all">{value}</span>
      <Copy size={13} className="shrink-0 text-default-400 group-hover:text-default-700" />
    </button>
  );
}
