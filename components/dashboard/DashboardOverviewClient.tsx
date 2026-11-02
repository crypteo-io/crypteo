"use client";

import { ButtonLink } from "@/components/site/Button";
import { ChainIcon } from "@/components/ui/ChainIcon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DashboardArea } from "@/components/layout/nav-items";
import { useIsClient } from "@/components/ui/useIsClient";
import { formatUsd } from "@/lib/billing/fee-schedule";
import type { Overview } from "@/lib/dashboard-overview";
import { formatAmount } from "@/lib/format";
import type { EndpointHealth } from "@/lib/payment/webhook-health";
import { AlertTriangle, ArrowRight, ChevronRight, Moon, ShieldCheck, Sun, Sunset, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RelativeTime } from "./RelativeTime";

interface Props extends Overview {
  /** A merchant's own overview, or the admin's across every merchant. */
  area: DashboardArea;
  /** Shown in the greeting; null falls back to a neutral "there". */
  merchantName?: string | null;
  /** Webhook URLs whose latest delivery failed (see lib/payment/webhook-health). */
  failingWebhooks?: EndpointHealth[];
}

// Recharts takes raw colours, not Tailwind classes; these mirror the tokens in
// globals.css (sky, navy, slate, accent-*).
const CHART = {
  navy: "#1c2f41",
  sky: "#135ca4",
  skySoft: "#5aa9f5",
  green: "#16a34a",
  amber: "#ea7a1e",
  red: "#e5484d",
  slate: "#94a3b8",
  grid: "#e2e8f0",
  axis: "#64748b",
};

const MORNING_START_HOUR = 5;
const AFTERNOON_START_HOUR = 12;
const EVENING_START_HOUR = 18;

function greetingFor(hour: number): { text: string; icon: LucideIcon } {
  if (hour >= MORNING_START_HOUR && hour < AFTERNOON_START_HOUR) return { text: "Good morning", icon: Sun };
  if (hour >= AFTERNOON_START_HOUR && hour < EVENING_START_HOUR) return { text: "Good afternoon", icon: Sunset };
  return { text: "Good evening", icon: Moon };
}

function plural(n: number, word: string) {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

export function DashboardOverviewClient({
  area,
  merchantName,
  failingWebhooks = [],
  stats,
  statusBreakdown,
  dailyVolumes,
  dailyLabels,
  recentPayments,
}: Props) {
  const platform = area === "admin";
  const isClient = useIsClient();

  const count = (k: keyof typeof statusBreakdown) => statusBreakdown[k] ?? 0;
  const inFlight = count("pending") + count("confirming");
  const totalSessions = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);
  const share = (n: number) => (totalSessions > 0 ? (n / totalSessions) * 100 : 0);
  const paidThisWeek = dailyVolumes.reduce((a, b) => a + b, 0);

  // Same hues as StatusBadge: green settled, sky in flight, amber needs a
  // look, navy overpaid, slate expired; late payments get red so they never
  // blend into Underpaid's amber.
  const mix = [
    { name: "Confirmed", value: count("confirmed"), color: CHART.green },
    { name: "Pending", value: count("pending"), color: CHART.skySoft },
    { name: "Confirming", value: count("confirming"), color: CHART.sky },
    { name: "Underpaid", value: count("underpaid"), color: CHART.amber },
    { name: "Overpaid", value: count("overpaid"), color: CHART.navy },
    { name: "Expired", value: count("expired"), color: CHART.slate },
    { name: "Late payment", value: count("expired_received"), color: CHART.red },
  ];
  const shownMix = mix.filter((d) => d.value > 0);

  const now = isClient ? new Date() : null;
  const greeting = now ? greetingFor(now.getHours()) : null;
  const GreetingIcon = greeting?.icon ?? Sun;

  const kpis = [
    {
      label: "Paid volume, 24h",
      value: `$${Math.round(stats.volume24h).toLocaleString("en-US")}`,
      hint: stats.volumeExcluded > 0 ? `Excludes ${plural(stats.volumeExcluded, "crypto-priced payment")}` : "USD value at creation",
    },
    { label: "Sessions, 24h", value: stats.total24h.toLocaleString("en-US"), hint: "Checkouts opened" },
    { label: "In flight", value: inFlight.toLocaleString("en-US"), hint: "Pending or confirming" },
    { label: "Paid, 7 days", value: paidThisWeek.toLocaleString("en-US"), hint: "Confirmed or overpaid" },
  ];

  return (
    <div className="space-y-8 pb-4">
      {failingWebhooks.length > 0 && <FailingWebhooks endpoints={failingWebhooks} />}

      <section className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <span className="eyebrow bg-white/50 backdrop-blur-sm">
            <GreetingIcon size={16} className="text-sky" />
            {now ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "Today"}
          </span>
          <h1 className="mt-4 break-words text-[34px] leading-[1.08] tracking-[-0.03em] md:text-[52px]">
            {greeting?.text ?? "Hello"}, {merchantName?.trim() || "there"}
          </h1>
          <p className="mt-3 text-[17px] text-default-700">
            {platform && "Platform-wide, every merchant's live payments. "}
            {inFlight > 0
              ? `${plural(inFlight, "payment")} waiting on the chain.`
              : "Nothing waiting on the chain right now."}
          </p>
        </div>
        {!platform && (
          <ButtonLink href="/dashboard/payments" size="sm" variant="white" className="shrink-0 self-start md:self-auto">
            All payments
          </ButtonLink>
        )}
      </section>

      <section aria-label="Key figures" className="frame">
        <dl className="frame-inner grid grid-cols-2 lg:grid-cols-4">
          {kpis.map((k, i) => (
            <div
              key={k.label}
              className={`p-5 md:p-7 ${i % 2 === 1 ? "border-l border-default-100" : ""} ${i >= 2 ? "border-t border-default-100 lg:border-t-0 lg:border-l" : ""}`}
            >
              <dt className="text-[14px] font-medium text-default-500">{k.label}</dt>
              <dd className="mt-2 font-heading text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-default-950 md:text-[40px]">
                {k.value}
              </dd>
              <dd className="mt-2.5 text-[12.5px] text-default-500">{k.hint}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-7.5">
        <section className="frame min-w-0">
          <div className="frame-inner h-full p-5 md:p-7">
            <div className="mb-6 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-[22px]">Paid payments</h2>
                <p className="mt-1 text-[14px] text-default-500">Per day, last 7 days (UTC)</p>
              </div>
            </div>
            <div className="h-[260px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={dailyVolumes.map((value, i) => ({ name: dailyLabels[i], value }))} margin={{ left: -24, right: 4, top: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="4 4" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: CHART.axis, fontSize: 12, fontWeight: 500 }} dy={8} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: CHART.axis, fontSize: 12, fontWeight: 500 }} />
                  <Tooltip
                    cursor={{ fill: "rgba(19, 92, 164, 0.06)" }}
                    content={({ active, payload }) =>
                      active && payload && payload.length ? (
                        <div className="rounded-xl border border-default-200 bg-white px-3 py-2 shadow-card-hover">
                          <p className="text-[12px] font-medium text-default-500">{payload[0].payload.name}</p>
                          <p className="font-heading text-[16px] font-semibold text-default-950">
                            {plural(Number(payload[0].value), "payment")}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="value" fill={CHART.navy} radius={[8, 8, 2, 2]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="frame min-w-0">
          <div className="frame-inner h-full p-5 md:p-7">
            <h2 className="text-[22px]">Status mix</h2>
            <p className="mt-1 text-[14px] text-default-500">
              {totalSessions > 0 ? `All ${plural(totalSessions, "session")}` : "No sessions yet"}
            </p>
            <div
              className="mt-6 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-default-100"
              role="img"
              aria-label={shownMix.map((d) => `${d.name} ${d.value}`).join(", ") || "No sessions"}
            >
              {shownMix.map((d) => (
                <span key={d.name} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${share(d.value)}%`, backgroundColor: d.color }} />
              ))}
            </div>
            <ul className="mt-6 divide-y divide-default-100">
              {mix.map((d) => (
                <li key={d.name} className="flex items-center gap-3 py-2.5 text-[14px]">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
                  <span className="flex-1 font-medium text-default-700">{d.name}</span>
                  <span className="font-semibold tabular-nums text-default-950">{d.value.toLocaleString("en-US")}</span>
                  <span className="w-12 text-right text-[13px] tabular-nums text-default-500">{Math.round(share(d.value))}%</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <section className="frame">
        <div className="frame-inner">
          <div className="flex items-center justify-between gap-3 px-5 pt-5 md:px-7 md:pt-7">
            <h2 className="text-[22px]">Recent payments</h2>
            <Link
              href={platform ? "/merchants" : "/dashboard/payments"}
              className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-primary"
            >
              {platform ? "All merchants" : "View all"}
              <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          {recentPayments.length === 0 ? (
            <p className="px-5 pt-4 pb-8 text-[14px] text-default-500 md:px-7">
              {platform ? "No live payments yet." : "No payments yet. Create a payment link to take your first one."}
            </p>
          ) : (
            <ul className="mt-3 grid gap-x-6 px-2 pb-2 md:px-4 md:pb-4 lg:grid-cols-2">
              {recentPayments.map((p) => (
                <li key={p.id} className="border-b border-default-100 last:border-b-0 lg:nth-last-2:odd:border-b-0">
                  <Link
                    href={platform ? `/merchants/${p.merchant.id}` : `/dashboard/payments/${p.id}`}
                    className="flex items-center gap-4 rounded-xl px-3 py-3.5 transition-colors hover:bg-default-50"
                  >
                    <span className="icon-tile size-11 shrink-0">
                      <ChainIcon chain={p.token || p.chain} size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-heading text-[15px] font-semibold tabular-nums text-default-950">
                        {formatAmount(p.expectedAmount, p.token)}{" "}
                        <span className="text-[12px] font-medium uppercase text-default-500">{p.token}</span>
                      </span>
                      <span className="block truncate text-[13px] text-default-500">
                        {p.usdValue !== null && <>≈ {formatUsd(p.usdValue)} · </>}
                        {platform && <>{p.merchant.name} · </>}
                        <RelativeTime value={p.createdAt} />
                      </span>
                    </span>
                    <StatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {!platform && <SelfCustodyCallout />}
    </div>
  );
}

function FailingWebhooks({ endpoints }: { endpoints: EndpointHealth[] }) {
  const one = endpoints.length === 1;
  return (
    <section role="alert" className="flex gap-3 rounded-2xl border border-accent-red/20 bg-white/90 p-5 backdrop-blur-sm">
      <AlertTriangle size={20} className="mt-0.5 shrink-0 text-accent-red" />
      <div className="min-w-0 flex-1 space-y-2 text-[14px] text-default-700">
        <p className="font-semibold text-default-950">
          {one
            ? "Your webhook endpoint is rejecting payment updates"
            : `${endpoints.length} webhook endpoints are rejecting payment updates`}
        </p>
        <p>
          {one
            ? "The site behind this URL isn't being told when payments complete or expire."
            : "The sites behind these URLs aren't being told when payments complete or expire."}
        </p>
        <ul className="space-y-1">
          {endpoints.map((w) => (
            <li key={w.url} className="text-[13px]">
              <span className="break-all font-mono text-default-700">{w.url}</span>
              <span className="text-default-500">
                {" "}
                · {w.failures} of {w.attempts} deliveries failed in 7 days, latest{" "}
                {w.lastStatusCode ? `HTTP ${w.lastStatusCode}` : "without a response"}
              </span>
            </li>
          ))}
        </ul>
        <p>
          Each URL must be a server route that accepts POST and answers 2xx.{" "}
          <Link href="/dashboard/settings?tab=webhooks" className="font-semibold text-sky underline">
            Webhook settings
          </Link>{" "}
          ·{" "}
          <Link href="/docs#webhooks" className="font-semibold text-sky underline">
            Docs
          </Link>
        </p>
      </div>
    </section>
  );
}

/** The one setup step that matters most for a non-custodial gateway: where the money lands. */
function SelfCustodyCallout() {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-linear-to-b from-primary to-primary-deep p-6 text-white md:p-8">
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 -z-10 size-56 rounded-full bg-sky-soft/25 blur-3xl" />
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10">
            <ShieldCheck size={20} className="text-sky-soft" />
          </span>
          <div>
            <h2 className="text-[20px] text-white">Receive into a self-custody wallet</h2>
            <p className="mt-1 max-w-xl text-[14px] text-white/70">
              Use Base Wallet or Trust Wallet, not an exchange deposit address. Exchanges hold deposits and ask about
              every incoming transfer.
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/wallets"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-medium text-primary transition-colors hover:bg-default-100"
        >
          Manage wallets <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
