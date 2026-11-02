"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { ChainIcon } from "@/components/ui/ChainIcon";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatUsd } from "@/lib/billing/fee-schedule";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Payment } from "@/types/payment";
import gsap from "gsap";
import {
    ChevronLeft,
    ChevronRight,
    Filter, Search
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useLayoutEffect, useRef } from "react";
import { PageHeader } from "./PageHeader";

interface Props {
  /** usdValue: the session's USD price when it was created (knownUsdValue); null when priced in a volatile token. */
  payments: (Payment & { usdValue: number | null })[];
  total: number;
  page: number;
  totalPages: number;
}

const chainOptions = [
  { value: "all", label: "Any Chain" },
  { value: "eth", label: "Ethereum" },
  { value: "btc", label: "Bitcoin" },
  { value: "sol", label: "Solana" },
  { value: "xrp", label: "XRP" },
  { value: "bsc", label: "BNB Smart Chain" },
  { value: "polygon", label: "Polygon" },
  { value: "tron", label: "Tron" },
  { value: "doge", label: "Dogecoin" },
  { value: "zec", label: "Zcash" },
  { value: "ada", label: "Cardano" },
  { value: "usdc", label: "USDC" },
  { value: "usdt", label: "USDT" },
];

export function PaymentsClient({ payments, total, page, totalPages }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [chainDropdownOpen, setChainDropdownOpen] = React.useState(false);
  const chainDropdownRef = React.useRef<HTMLDivElement>(null);

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
  }, [payments]);

  // Close chain dropdown on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        chainDropdownRef.current &&
        !chainDropdownRef.current.contains(e.target as Node)
      ) {
        setChainDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [searchTerm, setSearchTerm] = React.useState(
    searchParams.get("search") || "",
  );

  // Pagination keeps the active filters; a bare `?page=N` dropped them and
  // paged through the unfiltered list.
  const pageHref = (n: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(n));
    return `?${params.toString()}`;
  };

  const handleFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(key);
    else params.set(key, value);
    params.delete("page");
    router.push(`?${params.toString()}`);
  };

  const onSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (searchTerm) params.set("search", searchTerm);
    else params.delete("search");
    params.delete("page");
    router.push(`?${params.toString()}`);
  };

  const currentChain = searchParams.get("chain") || "all";
  const currentChainLabel =
    chainOptions.find((o) => o.value === currentChain)?.label || "Any Chain";

  return (
    <div ref={containerRef} className="space-y-8 pb-12">
      <div className="animate-up">
        <PageHeader
          title="Payments"
          subtitle={`${total.toLocaleString("en-US")} payment session${total === 1 ? "" : "s"} across every network`}
        />
      </div>

      {/* LIST */}
      <div className="frame animate-up">
        <div className="frame-inner">
          <div className="flex flex-col gap-3 border-b border-default-200 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-sky" aria-hidden />
              <h2 className="font-heading text-[16px] font-semibold text-default-950">All payments</h2>
              <span className="rounded-md bg-default-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-default-600">
                {total}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-1 min-h-11 bg-white border border-default-200 rounded-xl select-none max-w-full">
                <Filter size={15} className="text-default-500" aria-hidden />

                <select
                  aria-label="Filter by status"
                  className="bg-transparent text-[14px] font-medium text-default-950 focus:outline-none cursor-pointer appearance-none pr-4"
                  value={searchParams.get("status") || "all"}
                  onChange={(e) => handleFilter("status", e.target.value)}
                >
                  <option value="all">Any Status</option>
                  <option value="pending">Pending</option>
                  <option value="confirming">Confirming</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="underpaid">Underpaid</option>
                  <option value="overpaid">Overpaid</option>
                  <option value="expired">Expired</option>
                  <option value="expired_received">Late payment</option>
                </select>

                <div className="h-4 w-px bg-default-200 mx-2" />

                {/* Network filter with coin icons */}
                <div className="relative" ref={chainDropdownRef}>
                  <button
                    onClick={() => setChainDropdownOpen(!chainDropdownOpen)}
                    className="flex items-center gap-2 text-[14px] font-medium text-default-950 cursor-pointer hover:text-sky transition-colors"
                  >
                    {currentChain !== "all" && (
                      <ChainIcon chain={currentChain} size={18} />
                    )}
                    <span>{currentChainLabel}</span>
                    <svg
                      className={cn(
                        "w-3.5 h-3.5 text-default-500 transition-transform",
                        chainDropdownOpen && "rotate-180",
                      )}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {chainDropdownOpen && (
                    <div className="absolute top-full left-0 mt-2 bg-white border border-default-200 rounded-xl shadow-card-hover z-50 py-2 min-w-[200px]">
                      {chainOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            handleFilter("chain", opt.value);
                            setChainDropdownOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-medium hover:bg-default-50 transition-colors text-left",
                            currentChain === opt.value
                              ? "text-sky bg-sky/5"
                              : "text-default-700",
                          )}
                        >
                          {opt.value !== "all" && (
                            <ChainIcon chain={opt.value} size={20} />
                          )}
                          {opt.value === "all" && (
                            <span className="w-5 h-5 rounded-full bg-default-100 flex items-center justify-center text-[10px] text-default-500">
                              ✦
                            </span>
                          )}
                          {opt.label}
                          {currentChain === opt.value && (
                            <span className="ml-auto text-sky text-[12px]">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Search Input */}
              <div className="relative w-full sm:w-64">
                <Search
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-default-500"
                  size={16}
                />
                <input
                  type="text"
                  placeholder="Search ID, email or reference"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSearch()}
                  className="w-full bg-white border border-default-200 rounded-xl px-11 h-11 text-[14px] font-medium text-default-900 placeholder:text-default-400 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left stack-table">
              <thead>
                <tr className="border-b border-default-200 bg-default-50">
                  <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">Payment</th>
                  <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">Network</th>
                  <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">Status</th>
                  <th className="hidden 2xl:table-cell px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">Customer</th>
                  <th className="hidden xl:table-cell px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500">Created</th>
                  <th className="px-5 sm:px-6 py-3 text-[12px] font-medium text-default-500 text-right"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center">
                        <div className="icon-tile size-14 mb-4">
                          <Filter className="text-default-500" size={24} />
                        </div>
                        <p className="text-default-500 font-medium">
                          No payments found matching your current filters.
                        </p>
                        <button
                          onClick={() => router.push("/dashboard/payments")}
                          className="mt-4 text-[13px] font-semibold text-sky hover:underline cursor-pointer"
                        >
                          Clear all filters
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="group transition-colors hover:bg-default-50/70">
                      <td className="px-5 py-4 sm:px-6">
                        <div className="flex items-center gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-default-200 bg-default-50">
                            <ChainIcon chain={p.token || p.chain} size={22} />
                          </span>
                          <div className="min-w-0">
                            <p className="font-heading text-[14px] font-semibold tabular-nums text-default-950 whitespace-nowrap">
                              {formatAmount(p.expectedAmount, p.token)}{" "}
                              <span className="text-[12px] font-medium uppercase text-default-500">{p.token}</span>
                            </p>
                            {p.usdValue !== null && (
                              <p className="text-[12px] font-medium tabular-nums text-default-500">≈ {formatUsd(p.usdValue)}</p>
                            )}
                            <p className="font-mono text-[12px] text-default-500">
                              {p.id.slice(0, 10)}…
                              {p.externalId && (
                                <span className="ml-2 font-body text-default-400">{p.externalId}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td data-label="Network" className="px-5 py-4 sm:px-6 whitespace-nowrap">
                        {p.chain ? (
                          <ChainIcon chain={p.chain} size={18} showName />
                        ) : (
                          <span className="text-[13px] text-default-400">Not chosen yet</span>
                        )}
                      </td>
                      <td data-label="Status" className="px-5 py-4 sm:px-6">
                        <StatusBadge status={p.status} />
                      </td>
                      <td data-label="Customer" className="hidden 2xl:table-cell px-5 py-4 sm:px-6 max-w-[200px] truncate text-[13px] text-default-600">
                        {p.customerEmail || <span className="text-default-400">No email</span>}
                      </td>
                      <td data-label="Created" className="hidden xl:table-cell px-5 py-4 sm:px-6 whitespace-nowrap text-[13px] text-default-600">
                        <LocalDate
                          value={p.createdAt}
                          options={{
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          }}
                        />
                      </td>
                      <td data-actions className="px-5 py-4 sm:px-6 text-right">
                        <Link
                          href={`/dashboard/payments/${p.id}`}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-sky transition-colors hover:bg-sky/5"
                        >
                          Open <ChevronRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
          {totalPages > 1 && (
            <div className="px-5 sm:px-6 py-4 border-t border-default-200 flex flex-wrap items-center justify-between gap-3 text-[13px] text-default-500 font-medium">

              <span className="text-default-500">
                Showing page{" "}
                <span className="text-default-900 font-semibold">{page}</span> of{" "}
                <span className="text-default-900 font-semibold">{totalPages}</span>
              </span>
              <div className="flex gap-2">
                <Link
                  href={pageHref(Math.max(1, page - 1))}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-xl border transition-all font-semibold text-[13px]",
                    page === 1
                      ? "bg-default-50 text-default-400 cursor-not-allowed border-default-200"
                      : "bg-white text-default-700 hover:bg-default-50 border-default-200 shadow-sm",
                  )}
                >
                  <ChevronLeft size={16} /> Previous
                </Link>
                <Link
                  href={pageHref(Math.min(totalPages, page + 1))}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-xl border transition-all font-semibold text-[13px]",
                    page === totalPages
                      ? "bg-default-50 text-default-400 cursor-not-allowed border-default-200"
                      : "bg-white text-default-700 hover:bg-default-50 border-default-200 shadow-sm",
                  )}
                >
                  Next <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
