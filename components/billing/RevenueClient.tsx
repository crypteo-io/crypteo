"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest, ApiError } from "@/lib/api-client";
import {
  feeCopy, formatUsd, MAX_FEE_PERCENT, MAX_FEE_TIERS, MAX_INVOICE_EVERY_MONTHS, monthlyFee, type FeeSchedule, type FeeTier,
} from "@/lib/billing/fee-schedule";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  AlertTriangle, Banknote, Clock, PauseCircle, Play, Plus, Receipt, Save, Settings2, ShieldCheck, Trash2, TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminStatementsTable, type AdminStatementRow } from "./AdminStatementsTable";

interface Data {
  now: string;
  settings: {
    tiers: FeeTier[];
    monthlyCapUsd: number | null;
    minInvoiceUsd: number;
    monthlyInvoiceUsd: number | null;
    invoiceEveryMonths: number;
    billingEnabled: boolean;
    feesStartAt: string | null;
    billingMerchantId: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  admins: { id: string; name: string; email: string; feeWallets: string[] }[];
  kpis: {
    outstanding: number;
    openCount: number;
    overdue: number;
    overdueCount: number;
    collected: number;
    collected30d: number;
    waived: number;
    carried: number;
    held: number;
  };
  statements: AdminStatementRow[];
  exempt: {
    id: string;
    name: string;
    email: string;
    feeExemptReason: string | null;
    feeExemptBy: string | null;
    feeExemptAt: string | null;
  }[];
}

const inputClass =
  "w-full bg-white border border-default-200 rounded-xl px-4 py-2.5 text-[14px] font-medium text-default-900 focus:outline-none focus:border-primary transition-colors";
const labelClass = "text-[13px] font-medium text-default-700";
const STATUS_FILTERS = ["all", "open", "overdue", "paid", "carried", "waived"] as const;

export function RevenueClient({ data }: { data: Data }) {
  const router = useRouter();
  const confirm = useConfirm();
  const s = data.settings;

  const [tiers, setTiers] = useState(s.tiers.map((t) => ({ fromUsd: String(t.fromUsd), percent: String(t.percent) })));
  const [capOn, setCapOn] = useState(s.monthlyCapUsd != null);
  const [cap, setCap] = useState(String(s.monthlyCapUsd ?? 500));
  const [minInvoice, setMinInvoice] = useState(String(s.minInvoiceUsd));
  const [monthlyOn, setMonthlyOn] = useState(s.monthlyInvoiceUsd != null);
  const [monthlyInvoice, setMonthlyInvoice] = useState(String(s.monthlyInvoiceUsd ?? 100));
  const [everyMonths, setEveryMonths] = useState(s.invoiceEveryMonths);
  const [enabled, setEnabled] = useState(s.billingEnabled);
  const [billingAccount, setBillingAccount] = useState(s.billingMerchantId ?? "");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [previewVolume, setPreviewVolume] = useState("25000");

  const parsedTiers: FeeTier[] = tiers.map((t) => ({ fromUsd: Number(t.fromUsd), percent: Number(t.percent) }));
  const schedule: FeeSchedule = {
    tiers: parsedTiers,
    monthlyCapUsd: capOn ? Number(cap) : null,
    minInvoiceUsd: Number(minInvoice) || 0,
    monthlyInvoiceUsd: monthlyOn ? Number(monthlyInvoice) || 0 : null,
    invoiceEveryMonths: everyMonths,
  };
  const valid =
    parsedTiers.length > 0 &&
    parsedTiers[0].fromUsd === 0 &&
    parsedTiers.every(
      (t, i) =>
        Number.isFinite(t.fromUsd) &&
        Number.isFinite(t.percent) &&
        t.percent >= 0 &&
        t.percent <= MAX_FEE_PERCENT &&
        (i === 0 || t.fromUsd > parsedTiers[i - 1].fromUsd),
    );
  const monthlyTooLow =
    schedule.monthlyInvoiceUsd != null && schedule.monthlyInvoiceUsd <= schedule.minInvoiceUsd;
  const copy = valid ? feeCopy(schedule) : null;
  const preview = valid ? monthlyFee(schedule, Number(previewVolume) || 0) : null;
  const account = data.admins.find((a) => a.id === billingAccount);

  const save = async () => {
    setError(null);
    if (enabled && !s.billingEnabled) {
      const ok = await confirm({
        title: "Start charging platform fees?",
        description:
          `Sales from now on are billed. Each merchant's billing month ends on the day of the month they signed up. ${copy?.invoicing ?? ""} Unpaid invoices pause the merchant's checkouts after 7 days.`,
        confirmLabel: "Start billing",
        tone: "danger",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await toast.promise(
        apiRequest("/api/admin/billing/settings", {
          method: "PUT",
          body: {
            ...schedule,
            billingEnabled: enabled,
            billingMerchantId: billingAccount || null,
          },
        }),
        { loading: "Saving…", success: "Fee settings saved; the site shows them now", error: "Not saved" },
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : null);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await toast.promise(
        apiRequest<{ close: { created: number; invoiced: number; skipped?: string; errors: unknown[] } }>(
          "/api/admin/billing/run",
          { method: "POST" },
        ),
        { loading: "Running billing…", success: "Billing run finished", error: "Billing run failed" },
      );
      const c = r.close;
      toast.info(
        c.skipped ? `Nothing closed: ${c.skipped}` : `${c.created} statement(s), ${c.invoiced} invoiced`,
        c.errors.length ? `${c.errors.length} failed; details went to the admin alert list.` : undefined,
      );
      router.refresh();
    } catch {
      // toast shown
    } finally {
      setRunning(false);
    }
  };

  const rows = data.statements.filter((r) =>
    filter === "all"
      ? true
      : filter === "overdue"
        ? r.status === "open" && !!r.dueAt && r.dueAt < data.now
        : r.status === filter,
  );

  const k = data.kpis;
  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Revenue"
        subtitle={
          <>
            Platform fees:{" "}
            {s.billingEnabled ? (
              <>billing on since {s.feesStartAt ? <LocalDate value={s.feesStartAt} options={{ month: "short", day: "numeric", year: "numeric" }} /> : "–"}</>
            ) : (
              "billing is off"
            )}
          </>
        }
        actions={
          <button
            onClick={() => void runNow()}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-default-200 rounded-xl text-[13px] font-semibold text-default-800 hover:bg-default-50 disabled:opacity-50 cursor-pointer"
            title="Close every billing month that has ended, then settle, hold and remind. Safe to repeat."
          >
            <Play size={14} /> {running ? "Running…" : "Run billing now"}
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Receipt} label="Outstanding" value={formatUsd(k.outstanding)} hint={`${k.openCount} open invoice(s)`} />
        <MetricCard
          icon={AlertTriangle}
          label="Overdue"
          value={formatUsd(k.overdue)}
          hint={`${k.overdueCount} invoice(s) · ${k.held} merchant(s) paused`}
          tone={k.overdueCount ? "danger" : undefined}
        />
        <MetricCard icon={Banknote} label="Collected" value={formatUsd(k.collected)} hint={`${formatUsd(k.collected30d)} in the last 30 days`} tone="good" />
        <MetricCard icon={Clock} label="Carried / waived" value={formatUsd(k.carried)} hint={`${formatUsd(k.waived)} waived`} />
      </div>

      {/* SETTINGS */}
      <section className="frame">
      <div className={cn("frame-inner h-full", "p-6 space-y-6")}>
        <div className="flex flex-wrap items-center gap-2">
          <Settings2 size={18} className="text-sky" />
          <h2 className="text-[17px] font-heading font-semibold text-default-900">Fee settings</h2>
          {s.updatedAt && (
            <span className="ml-auto text-[12px] text-default-500">
              Last changed <LocalDate value={s.updatedAt} withTime /> by {s.updatedBy}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className={labelClass}>Rate by monthly paid volume</p>
              <p className="text-[12px] text-default-500">
                A merchant&apos;s whole billing month is charged the rate of the highest tier its volume reaches. One tier
                means a flat fee.
              </p>
              <div className="space-y-2">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[13px] text-default-500 w-12 shrink-0">From</span>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 text-[13px]">$</span>
                      <input
                        inputMode="decimal"
                        value={t.fromUsd}
                        disabled={i === 0}
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, fromUsd: e.target.value } : x)))}
                        className={cn(inputClass, "pl-7 disabled:opacity-60")}
                        aria-label={`Tier ${i + 1} starts at USD`}
                      />
                    </div>
                    <div className="relative w-32">
                      <input
                        inputMode="decimal"
                        value={t.percent}
                        onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                        className={cn(inputClass, "pr-8")}
                        aria-label={`Tier ${i + 1} percent`}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-default-400 text-[13px]">%</span>
                    </div>
                    <button
                      onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                      disabled={i === 0}
                      aria-label="Remove tier"
                      className="p-2.5 text-default-400 hover:text-accent-red disabled:opacity-0 cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              {tiers.length < MAX_FEE_TIERS && (
                <button
                  onClick={() => {
                    const last = parsedTiers[parsedTiers.length - 1];
                    setTiers([
                      ...tiers,
                      { fromUsd: String((last?.fromUsd || 0) * 2 || 10_000), percent: String(last?.percent ?? 0.3) },
                    ]);
                  }}
                  className="flex items-center gap-1.5 text-[13px] font-semibold text-default-600 hover:text-default-950 cursor-pointer"
                >
                  <Plus size={14} /> Add tier
                </button>
              )}
              {!valid && (
                <p className="text-[12px] text-accent-red">
                  The first tier starts at $0, each next tier starts higher, and rates are 0–{MAX_FEE_PERCENT}%.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-default-700">
                  <input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} />
                  Monthly cap per merchant
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 text-[13px]">$</span>
                  <input inputMode="decimal" value={cap} disabled={!capOn} onChange={(e) => setCap(e.target.value)} className={cn(inputClass, "pl-7 disabled:opacity-50")} />
                </div>
                <p className="text-[12px] text-default-500">The most one merchant pays for one billing month.</p>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-default-700">Minimum to invoice</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 text-[13px]">$</span>
                  <input inputMode="decimal" value={minInvoice} onChange={(e) => setMinInvoice(e.target.value)} className={cn(inputClass, "pl-7")} />
                </div>
                <p className="text-[12px] text-default-500">
                  No invoice until a merchant owes this; until then it carries forward.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-default-700">Invoice every</p>
                <select value={everyMonths} onChange={(e) => setEveryMonths(Number(e.target.value))} className={inputClass}>
                  {Array.from({ length: MAX_INVOICE_EVERY_MONTHS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "1 billing month" : `${n} billing months (about ${n * 30} days)`}
                    </option>
                  ))}
                </select>
                <p className="text-[12px] text-default-500">How often a merchant over the minimum is invoiced.</p>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-default-700">
                  <input type="checkbox" checked={monthlyOn} onChange={(e) => setMonthlyOn(e.target.checked)} />
                  Invoice monthly from
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 text-[13px]">$</span>
                  <input inputMode="decimal" value={monthlyInvoice} disabled={!monthlyOn} onChange={(e) => setMonthlyInvoice(e.target.value)} className={cn(inputClass, "pl-7 disabled:opacity-50")} />
                </div>
                <p className={cn("text-[12px]", monthlyTooLow ? "text-accent-red" : "text-default-500")}>
                  {monthlyTooLow
                    ? "Must be above the minimum to invoice."
                    : "Owing this or more is invoiced at the end of that billing month."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-default-700">Account that receives fees</p>
                <select value={billingAccount} onChange={(e) => setBillingAccount(e.target.value)} className={inputClass}>
                  <option value="">Choose an admin account…</option>
                  {data.admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.email})
                    </option>
                  ))}
                </select>
                <p className={cn("text-[12px]", account && account.feeWallets.length === 0 ? "text-accent-red" : "text-default-500")}>
                  {account
                    ? account.feeWallets.length
                      ? `Merchants can pay to: ${account.feeWallets.join(", ")}`
                      : "This account has no active USDT/USDC wallet: add one on its Wallets page or merchants can't pay."
                    : "Fee checkouts pay into this account's USDT/USDC wallets."}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-default-700">Billing</p>
                <button
                  onClick={() => setEnabled((v) => !v)}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-[14px] font-semibold cursor-pointer",
                    enabled ? "border-accent-green/30 bg-accent-green/5 text-accent-green" : "border-default-200 text-default-500",
                  )}
                >
                  {enabled ? "On: merchants are invoiced" : "Off: no new invoices"}
                  {enabled ? <TrendingUp size={16} /> : <PauseCircle size={16} />}
                </button>
                <p className="text-[12px] text-default-500">
                  Turning it off stops new statements. Open invoices still need paying or waiving.
                </p>
              </div>
            </div>

            {error && <p className="text-[13px] font-medium text-accent-red">{error}</p>}
            <button
              onClick={() => void save()}
              disabled={saving || !valid || monthlyTooLow}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl text-[14px] font-semibold hover:bg-primary-deep disabled:opacity-40 cursor-pointer"
            >
              <Save size={15} /> {saving ? "Saving…" : "Save fee settings"}
            </button>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl bg-linear-to-b from-primary to-primary-deep text-white p-5 space-y-3">
              <p className="text-[12px] font-medium text-white/60">On the public site</p>
              {copy ? (
                <>
                  <p className="text-[28px] font-heading font-semibold text-sky-soft">{copy.range}</p>
                  <p className="text-[13px] text-white/75">
                    Pricing tiers: {copy.tiers.map((t) => `${t.percent}%`).join(" · ")}
                    {copy.monthlyCap ? ` · capped at ${copy.monthlyCap}/month` : ""}
                  </p>
                  <p className="text-[12px] text-white/60">Home, pricing, FAQ and terms update on their next load after you save.</p>
                </>
              ) : (
                <p className="text-[13px] text-white/60">Fix the tiers to preview.</p>
              )}
            </div>
            <div className="rounded-2xl border border-default-200 p-5 space-y-3">
              <p className={labelClass}>Try a month</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-default-400 text-[13px]">$</span>
                <input inputMode="decimal" value={previewVolume} onChange={(e) => setPreviewVolume(e.target.value)} className={cn(inputClass, "pl-7")} aria-label="Monthly paid volume" />
              </div>
              {preview && (
                <p className="text-[14px] text-default-700">
                  {preview.ratePercent}% → <strong className="text-default-950">{formatUsd(preview.feeUsd)}</strong>
                  <span className="block text-[12px] text-default-500 mt-1">
                    {preview.feeUsd <= 0 || preview.feeUsd < schedule.minInvoiceUsd
                      ? "Under the minimum: carried forward, not invoiced."
                      : schedule.monthlyInvoiceUsd != null && preview.feeUsd >= schedule.monthlyInvoiceUsd
                        ? "At the monthly threshold: invoiced at the month's end."
                        : everyMonths === 1
                          ? "Invoiced at the month's end."
                          : `Invoiced every ${everyMonths} billing months.`}
                  </span>
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
      </section>

      {/* EXEMPTIONS */}
      <section className="frame">
      <div className={cn("frame-inner h-full", "overflow-hidden")}>
        <div className="px-6 py-4 border-b border-default-200 bg-default-50 flex items-center gap-2">
          <ShieldCheck size={16} className="text-sky" />
          <h2 className="text-[15px] font-heading font-semibold text-default-900">Fee-exempt accounts ({data.exempt.length})</h2>
          <span className="ml-auto text-[12px] text-default-500">Granted from each merchant&apos;s page, with a reason</span>
        </div>
        {data.exempt.length === 0 ? (
          <p className="px-6 py-6 text-[13px] text-default-500">
            No merchant is exempt. Admin accounts are never charged.
          </p>
        ) : (
          <ul className="divide-y divide-default-100">
            {data.exempt.map((m) => (
              <li key={m.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-2 justify-between">
                <div className="min-w-0">
                  <Link href={`/merchants/${m.id}`} className="text-[14px] font-semibold text-default-900 hover:underline">
                    {m.name}
                  </Link>
                  <span className="ml-2 text-[12px] text-default-500">{m.email}</span>
                  <p className="text-[13px] text-default-600 mt-0.5">{m.feeExemptReason ?? "No reason recorded"}</p>
                </div>
                <p className="text-[12px] text-default-500 shrink-0">
                  {m.feeExemptBy ?? "–"}
                  {m.feeExemptAt && (
                    <>
                      {" · "}
                      <LocalDate value={m.feeExemptAt} options={{ month: "short", day: "numeric", year: "numeric" }} />
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      </section>

      {/* STATEMENTS */}
      <section className="frame">
      <div className={cn("frame-inner h-full", "overflow-hidden")}>
        <div className="px-6 py-4 border-b border-default-200 bg-default-50 flex flex-wrap items-center gap-3">
          <Receipt size={16} className="text-sky" />
          <h2 className="text-[15px] font-heading font-semibold text-default-900">Invoices & statements</h2>
          <div className="ml-auto flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[12px] font-semibold capitalize cursor-pointer",
                  filter === f ? "bg-primary text-white" : "text-default-500 hover:text-default-900",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <AdminStatementsTable rows={rows} now={data.now} empty="No statements match." />
      </div>
      </section>
    </div>
  );
}
