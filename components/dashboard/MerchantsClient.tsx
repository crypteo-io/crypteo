"use client";

import { LocalDate } from "@/components/ui/LocalDate";
import { ACCOUNT_STATES, accountState, type AccountState } from "@/lib/account-state";
import { reservedEmailRefusal, reservedNameRefusal } from "@/lib/reserved-names";
import { cn } from "@/lib/utils";
import gsap from "gsap";
import {
    ArrowRight, Calendar, MailWarning, Megaphone, MessageSquare, Plus, Search, ShieldAlert,
    Trash2, User, UserCheck
} from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { CreateMerchantForm } from "./CreateMerchantForm";
import { MessageDialog, type MessageAudience } from "./MessageDialog";

interface Merchant {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerified: string | null;
  twoFactorMethod: string;
  createdAt: string;
  billingHoldAt: string | null;
  disposableEmail: boolean;
  _count: { payments: number; wallets: number };
}

const STATE_FILTERS = ["all", ...ACCOUNT_STATES] as const;
type StateFilter = (typeof STATE_FILTERS)[number];

export function MerchantsClient({
  merchants: initial,
}: {
  merchants: Merchant[];
}) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "merchant">("all");
  const [creating, setCreating] = useState(false);
  const [audience, setAudience] = useState<MessageAudience | null>(null);
  const activeMerchants = initial.filter((m) => m.role === "merchant" && accountState(m) !== "deleted" && m.isActive).length;
  const containerRef = useRef<HTMLDivElement>(null);

  const query = search.toLowerCase();
  const merchants = initial.filter(
    (m) =>
      (m.name.toLowerCase().includes(query) || m.email.toLowerCase().includes(query)) &&
      (stateFilter === "all" || accountState(m) === stateFilter) &&
      (roleFilter === "all" || m.role === roleFilter),
  );

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(".animate-up", {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.05,
        ease: "power2.out",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="space-y-8 pb-12">
      <div className="animate-up">
        <PageHeader
          title="Merchants"
          subtitle={`${initial.length} registered account${initial.length === 1 ? "" : "s"}`}
          actions={
            <>
              <button
                onClick={() => setAudience({ kind: "all_merchants", count: activeMerchants })}
                title="Message every active merchant"
                className="inline-flex items-center gap-2 rounded-xl border border-default-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-default-800 transition-colors hover:bg-default-50 cursor-pointer"
              >
                <Megaphone size={16} /> Message all
              </button>
              <button
                onClick={() => setCreating((v) => !v)}
                aria-expanded={creating}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-aigocy-dark transition-colors hover:bg-primary-deep cursor-pointer"
              >
                <Plus size={16} /> New account
              </button>
            </>
          }
        />
      </div>

      {creating && <CreateMerchantForm onClose={() => setCreating(false)} />}
      {audience && <MessageDialog audience={audience} onClose={() => setAudience(null)} />}

      {/* MERCHANTS LIST */}
      <div className="frame animate-up">
      <div className="frame-inner overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-default-200 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-sky" aria-hidden />
            <h2 className="font-heading text-[16px] font-semibold text-default-950">Accounts</h2>
            <span className="rounded-md bg-default-100 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-default-600">
              {merchants.length}
            </span>
          </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative group w-full sm:w-auto sm:flex-1 sm:min-w-[240px] lg:max-w-sm">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-default-500 group-focus-within:text-sky transition-colors"
              size={16}
            />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 h-11 bg-white border border-default-200 rounded-xl text-[14px] font-medium text-default-800 focus:outline-none focus:ring-4 focus:ring-sky/10 focus:border-sky transition-all"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as StateFilter)}
            aria-label="Filter by status"
            className="h-11 px-3 bg-white border border-default-200 rounded-xl text-[13px] font-semibold text-default-700 capitalize cursor-pointer"
          >
            {STATE_FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? "All statuses" : f}
              </option>
            ))}
          </select>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
            aria-label="Filter by role"
            className="h-11 px-3 bg-white border border-default-200 rounded-xl text-[13px] font-semibold text-default-700 cursor-pointer"
          >
            <option value="all">All roles</option>
            <option value="merchant">Merchants</option>
            <option value="admin">Admins</option>
          </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left stack-table">
            <thead>
              <tr className="border-b border-default-200 bg-default-50">
                <th className="px-5 py-3 text-[12px] font-medium text-default-500">
                  Account
                </th>
                <th className="hidden xl:table-cell px-5 py-3 text-[12px] font-medium text-default-500">
                  Activity
                </th>
                <th className="hidden xl:table-cell px-5 py-3 text-[12px] font-medium text-default-500">
                  Joined
                </th>
                <th className="px-5 py-3 text-[12px] font-medium text-default-500">
                  Status
                </th>
                <th className="px-5 py-3 text-[12px] font-medium text-default-500 text-right">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default-100">
              {merchants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-24 text-center">
                    <p className="text-default-500 font-medium">
                      No merchants found matching your registry search.
                    </p>
                  </td>
                </tr>
              ) : (
                merchants.map((m) => (
                  <tr
                    key={m.id}
                    className="hover:bg-default-50/80 transition-colors group"
                  >
                    <td className="px-5 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 icon-tile text-default-600 shrink-0">
                          <User size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-default-900 flex flex-wrap items-center gap-2">
                            {m.name}
                            {m.role === "admin" && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-semibold border bg-sky/5 text-sky border-sky/15">
                                Admin
                              </span>
                            )}
                            {reservedNameRefusal(m.name, m.role) && <ReservedNameBadge />}
                            {m.disposableEmail && <TemporaryEmailBadge />}
                            {reservedEmailRefusal(m.email, m.role) && <PlatformEmailBadge />}
                          </p>
                          <p className="text-[12px] text-default-500 mt-0.5 break-all">
                            {m.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td data-label="Activity" className="hidden xl:table-cell px-5 py-5 text-[13px] text-default-500 font-medium whitespace-nowrap">
                      <div>
                        {m._count.payments} payments · {m._count.wallets} wallets
                        <p className="text-[11px] text-default-500 mt-0.5">
                          2FA: {m.twoFactorMethod === "totp" ? "Authenticator" : "Email"}
                        </p>
                      </div>
                    </td>
                    <td data-label="Joined" className="hidden xl:table-cell px-5 py-5">
                      <div className="flex items-center gap-2 text-default-500 text-[13px] font-medium">
                        <Calendar size={14} className="text-default-400" />
                        <LocalDate
                          value={m.createdAt}
                          options={{ month: "short", day: "numeric", year: "numeric" }}
                        />
                      </div>
                    </td>
                    <td data-label="Status" className="px-5 py-5">
                      <div>
                        <AccountStateBadge state={accountState(m)} />
                        {m.billingHoldAt && (
                          <p className="text-[11px] font-semibold text-accent-red mt-1">Billing hold</p>
                        )}
                      </div>
                    </td>
                    <td data-actions className="px-5 py-5 text-right whitespace-nowrap">
                      {accountState(m) !== "deleted" && (
                        <button
                          onClick={() =>
                            setAudience({ kind: "direct", merchants: [{ id: m.id, name: m.name, email: m.email }] })
                          }
                          title={`Message ${m.name}`}
                          aria-label={`Message ${m.name}`}
                          className="inline-flex items-center justify-center w-9 h-9 mr-2 rounded-xl border border-default-200 text-default-500 bg-white hover:text-default-950 hover:bg-default-50 cursor-pointer align-middle"
                        >
                          <MessageSquare size={15} />
                        </button>
                      )}
                      <Link
                        href={`/merchants/${m.id}`}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-default-200 text-[13px] font-semibold text-default-700 bg-white hover:bg-default-50 hover:text-default-950 transition-colors group/btn"
                      >
                        Manage{" "}
                        <ArrowRight
                          size={14}
                          className="group-hover/btn:translate-x-1 transition-transform"
                        />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}

export function AccountStateBadge({ state }: { state: AccountState }) {
  const styles: Record<AccountState, { label: string; className: string; icon: typeof UserCheck }> = {
    active: { label: "Active", className: "text-accent-green", icon: UserCheck },
    unverified: { label: "Unverified", className: "text-amber-600", icon: MailWarning },
    suspended: { label: "Suspended", className: "text-accent-red", icon: ShieldAlert },
    deleted: { label: "Deleted", className: "text-default-500", icon: Trash2 },
  };
  const { label, className, icon: Icon } = styles[state];
  return (
    <span className={cn("inline-flex items-center text-[12px] font-semibold", className)}>
      <Icon size={14} className="mr-1.5" /> {label}
    </span>
  );
}

function WarningBadge({ title, label }: { title: string; label: string }) {
  return (
    <span
      title={title}
      className="inline-flex px-2 py-0.5 rounded-pill text-[11px] font-semibold capitalize bg-amber-50 text-amber-700 border border-amber-200"
    >
      {label}
    </span>
  );
}

/** Flags a display name the platform no longer allows, so an admin renames it. */
export function ReservedNameBadge() {
  return (
    <WarningBadge
      title="This name is reserved for the platform. Rename it from the merchant's page."
      label="Reserved name"
    />
  );
}

/** Flags a merchant on the platform's own domain, which reads as staff. */
export function PlatformEmailBadge() {
  return (
    <WarningBadge
      title="This merchant's email is on the platform's domain. Change it, or delete the account if it isn't ours."
      label="Platform email"
    />
  );
}

/** Flags an account signed up with a throwaway inbox, before signups refused them. */
function TemporaryEmailBadge() {
  return (
    <WarningBadge title="This account uses a temporary email address." label="Temporary email" />
  );
}
