"use client";

import { ChainIcon } from "@/components/ui/ChainIcon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { PlatformAnalytics } from "@/lib/admin-analytics";
import { formatUsd } from "@/lib/billing/fee-schedule";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "./PageHeader";
import { Activity, CheckCircle2, DollarSign, Percent, Store, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const th = "px-5 py-3 text-[12px] font-medium text-default-500";
const td = "px-5 py-3.5 text-[13px] text-default-600 whitespace-nowrap";

const compactUsd = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}k` : `$${Math.round(v)}`;
const monthShort = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const dayShort = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function AnalyticsClient({ data }: { data: PlatformAnalytics }) {
  const [metric, setMetric] = useState<"paidUsd" | "paid">("paidUsd");
  const w = data.window;
  const m = data.merchants;

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Analytics"
        subtitle="Live merchant sales across the platform. Last 30 days unless stated; test payments and fee payments excluded."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={DollarSign} label="Paid volume (30d)" value={formatUsd(Math.round(w.paidUsd))} hint={w.unpriced ? `+ ${w.unpriced} crypto-priced sale(s) not in USD` : `${w.paid} paid sessions`} />
        <MetricCard icon={CheckCircle2} label="Paid sessions (30d)" value={String(w.paid)} hint={`of ${w.sessions} created`} />
        <MetricCard icon={Percent} label="Conversion" value={w.conversion === null ? "–" : `${(w.conversion * 100).toFixed(1)}%`} hint="Paid ÷ sessions that reached an outcome" />
        <MetricCard icon={Activity} label="Average sale" value={w.averageUsd === null ? "–" : formatUsd(Math.round(w.averageUsd * 100) / 100)} hint="Priced paid sessions" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={Users} label="Merchants" value={String(m.total)} hint={`${m.active} active · ${m.suspended} suspended`} />
        <MetricCard icon={Store} label="Selling (30d)" value={String(m.withSales30d)} hint={`${m.new30d} new sign-ups`} />
        <MetricCard icon={Users} label="Billing hold" value={String(m.onHold)} hint="Checkouts paused for unpaid fees" tone={m.onHold ? "danger" : undefined} />
        <MetricCard icon={Users} label="Fee exempt" value={String(m.exempt)} hint="See Revenue for reasons" />
      </div>

      <section className="frame">
      <div className={cn("frame-inner h-full", "p-6")}>
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <h2 className="text-[17px] font-heading font-semibold text-default-900">Last 12 months</h2>
          <div className="ml-auto flex bg-default-100 rounded-lg p-1">
            {(["paidUsd", "paid"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setMetric(k)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[12px] font-semibold cursor-pointer",
                  metric === k ? "bg-white text-default-950 shadow-premium" : "text-default-500 hover:text-default-900",
                )}
              >
                {k === "paidUsd" ? "Volume (USD)" : "Paid sessions"}
              </button>
            ))}
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthly}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={metric === "paidUsd" ? compactUsd : undefined} tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={56} />
              <Tooltip
                labelFormatter={(l) => monthShort(String(l))}
                formatter={(v) => (metric === "paidUsd" ? formatUsd(Math.round(Number(v))) : v)}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
              />
              <Bar dataKey={metric} name={metric === "paidUsd" ? "Volume" : "Paid"} fill="#135ca4" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="frame">
        <div className={cn("frame-inner h-full", "p-6")}>
          <h2 className="text-[17px] font-heading font-semibold text-default-900 mb-6">Daily paid volume (30d)</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daily}>
                <defs>
                  <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5aa9f5" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#5aa9f5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="day" tickFormatter={dayShort} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={compactUsd} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={52} />
                <Tooltip labelFormatter={(l) => dayShort(String(l))} formatter={(v) => formatUsd(Math.round(Number(v)))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
                <Area type="monotone" dataKey="paidUsd" name="Volume" stroke="#135ca4" fill="url(#vol)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        </section>

        <section className="frame">
        <div className={cn("frame-inner h-full", "p-6")}>
          <h2 className="text-[17px] font-heading font-semibold text-default-900 mb-6">Fees collected by month</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tickFormatter={monthShort} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compactUsd} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={52} />
                <Tooltip labelFormatter={(l) => monthShort(String(l))} formatter={(v) => formatUsd(Number(v))} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
                <Bar dataKey="feesCollected" name="Collected" fill="#1c2f41" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="frame">
        <div className={cn("frame-inner h-full", "overflow-hidden")}>
          <h2 className="px-6 py-4 border-b border-default-200 text-[15px] font-heading font-semibold text-default-900">Top merchants (30d)</h2>
          {data.topMerchants.length === 0 ? (
            <p className="px-6 py-8 text-[13px] text-default-500">No paid sales in the last 30 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left stack-table">
                <thead>
                  <tr className="border-b border-default-200 bg-default-50">
                    <th className={th}>Merchant</th>
                    <th className={th}>Paid</th>
                    <th className={cn(th, "text-right")}>Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default-100">
                  {data.topMerchants.map((t) => (
                    <tr key={t.id}>
                      <td className={td}>
                        <Link href={`/merchants/${t.id}`} className="font-semibold text-default-900 hover:underline">
                          {t.name}
                        </Link>
                        <p className="text-[11px] text-default-500">{t.email}</p>
                      </td>
                      <td data-label="Paid" className={td}>{t.paid}</td>
                      <td data-label="Volume" className={cn(td, "text-right font-semibold text-default-900")}>{formatUsd(Math.round(t.paidUsd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </section>

        <section className="frame">
        <div className={cn("frame-inner h-full", "overflow-hidden")}>
          <h2 className="px-6 py-4 border-b border-default-200 text-[15px] font-heading font-semibold text-default-900">By network (30d)</h2>
          {data.byNetwork.length === 0 ? (
            <p className="px-6 py-8 text-[13px] text-default-500">No paid sales in the last 30 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left stack-table">
                <thead>
                  <tr className="border-b border-default-200 bg-default-50">
                    <th className={th}>Network</th>
                    <th className={th}>Paid</th>
                    <th className={th}>Received</th>
                    <th className={cn(th, "text-right")}>USD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default-100">
                  {data.byNetwork.map((n) => (
                    <tr key={`${n.chain}-${n.token}`}>
                      <td className={cn(td, "uppercase font-semibold text-default-800")}>
                        <span className="inline-flex items-center gap-2">
                          <ChainIcon chain={n.chain} size={18} /> {n.chain} · {n.token}
                        </span>
                      </td>
                      <td data-label="Paid" className={td}>{n.paid}</td>
                      <td data-label="Received" className={td}>
                        {Number(n.amount.toFixed(6))} {n.token.toUpperCase()}
                      </td>
                      <td data-label="USD" className={cn(td, "text-right")}>{n.paidUsd ? formatUsd(Math.round(n.paidUsd)) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </section>
      </div>

      <section className="frame">
      <div className={cn("frame-inner h-full", "p-6")}>
        <h2 className="text-[15px] font-heading font-semibold text-default-900 mb-4">Session outcomes (30d)</h2>
        <div className="flex flex-wrap gap-3">
          {w.statusCounts.length === 0 && <p className="text-[13px] text-default-500">No sessions.</p>}
          {[...w.statusCounts]
            .sort((a, b) => b.count - a.count)
            .map((s) => (
              <div key={s.status} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-default-200">
                <StatusBadge status={s.status} />
                <span className="text-[14px] font-semibold text-default-900">{s.count}</span>
              </div>
            ))}
        </div>
      </div>
      </section>
    </div>
  );
}
