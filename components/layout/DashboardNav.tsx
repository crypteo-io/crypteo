"use client";

import { Logo } from "@/components/site/Logo";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { signOutHere } from "@/lib/sign-out";
import { cn } from "@/lib/utils";
import { ChevronDown, LogOut, Menu, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { AREA_HOME, NAV_IN_TABS, accountLinks, activeNavGroup, dashboardNav, isActiveNav, type DashboardArea } from "./nav-items";
import { NotificationBell } from "./NotificationBell";

/** Closes a popover on an outside press or Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

/**
 * The dashboards' floating navbar, the landing page's in a dashboard role:
 * notifications and the account menu, plus for admins one menu per nav group
 * and a phone menu (merchants navigate with the tab strip).
 */
export function DashboardNav({
  area,
  user,
}: {
  area: DashboardArea;
  user: { name?: string | null; email?: string | null; role: string };
}) {
  const merchant = area === "merchant";
  const pathname = usePathname() ?? "";
  const groups = NAV_IN_TABS[area] ? [] : dashboardNav(area);
  const current = activeNavGroup(area, pathname);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const closeAll = () => {
    setOpenGroup(null);
    setMobileOpen(false);
  };
  useDismiss(openGroup !== null || mobileOpen, navRef, closeAll);

  return (
    <header ref={navRef} className="container-site fixed inset-x-0 top-0 z-50">
      <div className="my-2.5 rounded-2xl bg-white/30 p-1.5 backdrop-blur-md md:my-4">
        <nav
          aria-label="Dashboard"
          className="flex w-full items-center gap-2 rounded-xl border border-default-100 bg-white/90 px-3 py-2 md:px-4"
        >
          <Link
            href={AREA_HOME[area]}
            aria-label={area === "admin" ? "Admin overview" : "Dashboard overview"}
            onClick={closeAll}
            className="flex shrink-0 items-center gap-2 pr-2"
          >
            <Logo markClassName="size-7" className="[&>span:last-child]:text-xl" />
            {area === "admin" && (
              <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                Admin
              </span>
            )}
          </Link>

          <ul className="hidden items-center lg:flex">
            {groups.map((group) => {
              const open = openGroup === group.label;
              const active = current?.label === group.label;
              return (
                <li key={group.label} className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenGroup(open ? null : group.label)}
                    aria-expanded={open}
                    aria-haspopup="true"
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-3.5 py-2.5 font-medium transition-colors hover:text-primary",
                      active ? "text-primary" : "text-default-600",
                    )}
                  >
                    {group.label}
                    <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
                    {active && <span className="absolute inset-x-3.5 bottom-1 h-0.5 rounded-full bg-sky" aria-hidden />}
                  </button>
                  {open && (
                    <div className="absolute top-full left-0 mt-3 w-80">
                      <div className="frame bg-white/95 shadow-card-hover backdrop-blur">
                        <ul className="frame-inner p-1.5">
                          {group.items.map((item) => {
                            const here = isActiveNav(area, pathname, item.href);
                            return (
                              <li key={item.href}>
                                <Link
                                  href={item.href}
                                  onClick={closeAll}
                                  aria-current={here ? "page" : undefined}
                                  className={cn(
                                    "flex items-start gap-3 rounded-xl p-3 transition-colors",
                                    here ? "bg-default-50" : "hover:bg-default-50",
                                  )}
                                >
                                  <span className={cn("icon-tile size-9 shrink-0", here && "border-primary bg-primary text-white from-primary")}>
                                    <item.icon size={17} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block font-heading text-[15px] font-semibold text-default-950">{item.name}</span>
                                    <span className="block text-[13px] text-default-500">{item.description}</span>
                                  </span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {merchant && <PaymentSearch onSearch={closeAll} />}
            <NotificationBell area={area} />
            {merchant && (
              <Link
                href="/dashboard/payment-links/create"
                aria-label="New payment link"
                onClick={closeAll}
                className="inline-flex size-10 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-deep sm:w-auto sm:px-4"
              >
                <Plus size={16} /> <span className="hidden sm:inline">New link</span>
              </Link>
            )}
            <AccountMenu area={area} user={user} />
            {groups.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setOpenGroup(null);
                  setMobileOpen((v) => !v);
                }}
                aria-expanded={mobileOpen}
                aria-controls="dashboard-mobile-menu"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                className="inline-flex size-10 items-center justify-center rounded-lg text-default-900 hover:bg-default-100 lg:hidden"
              >
                {mobileOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            )}
          </div>
        </nav>

        {mobileOpen && (
          <div
            id="dashboard-mobile-menu"
            className="mt-1.5 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-default-100 bg-white p-2 lg:hidden"
          >
            {groups.map((group) => (
              <div key={group.label} className="py-1">
                <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-default-400">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const here = isActiveNav(area, pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={closeAll}
                      aria-current={here ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-4 py-2.5 font-medium",
                        here ? "bg-primary/5 text-primary" : "text-default-700 hover:bg-default-50",
                      )}
                    >
                      <item.icon size={17} className={here ? "text-primary" : "text-default-400"} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * The payments list already filters on ?search= (id, customer email or
 * external id), so the navbar's search is a shortcut into it. Collapsed to an
 * icon until it's wanted.
 */
function PaymentSearch({ onSearch }: { onSearch: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useDismiss(open, formRef, () => setOpen(false));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    onSearch();
    setOpen(false);
    router.push(q ? `/dashboard/payments?search=${encodeURIComponent(q)}` : "/dashboard/payments");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search payments"
        className="hidden size-10 items-center justify-center rounded-xl text-default-600 transition-colors hover:bg-default-100 hover:text-default-950 sm:flex"
      >
        <Search size={18} />
      </button>
    );
  }
  return (
    <form ref={formRef} role="search" onSubmit={submit} className="relative hidden sm:block">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-default-400" />
      <label htmlFor="nav-search" className="sr-only">
        Search payments
      </label>
      <input
        id="nav-search"
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ID, email or reference"
        className="h-10 w-56 rounded-xl border border-default-200 bg-white pr-3 pl-10 text-[14px] text-default-900 placeholder:text-default-400 focus:border-primary focus:outline-none xl:w-64"
      />
    </form>
  );
}

function AccountMenu({
  area,
  user,
}: {
  area: DashboardArea;
  user: { name?: string | null; email?: string | null; role: string };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();
  useDismiss(open, ref, () => setOpen(false));

  const logOut = async () => {
    setOpen(false);
    const ok = await confirm({
      title: "Log out?",
      description: "You'll need your password, and a verification code on an unremembered device, to sign back in.",
      confirmLabel: "Log out",
    });
    if (ok) await signOutHere();
  };

  const initial = (user.name || user.email || "M").trim().charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex size-10 items-center justify-center rounded-xl bg-linear-to-b from-primary to-primary-deep font-heading text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 mt-3 w-64">
          <div className="frame bg-white/95 shadow-card-hover backdrop-blur">
            <div className="frame-inner overflow-hidden">
              <div className="border-b border-default-100 px-4 py-3.5">
                <p className="truncate text-[14px] font-semibold text-default-950">{user.name || "Your account"}</p>
                {user.email && <p className="truncate text-[12px] text-default-500">{user.email}</p>}
                <span className="mt-2 inline-flex rounded-md bg-default-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-default-600">
                  {user.role}
                </span>
              </div>
              <div className="p-1.5">
                {accountLinks(area).map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-default-700 hover:bg-default-50 hover:text-default-950"
                  >
                    <item.icon size={15} className="text-default-500" /> {item.name}
                  </Link>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={logOut}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-default-700 hover:bg-accent-red/5 hover:text-accent-red"
                >
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
