"use client";

import { Logo } from "@/components/site/Logo";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { signOutHere } from "@/lib/sign-out";
import { LogOut, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { AREA_HOME, accountLinks, type DashboardArea } from "./nav-items";
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
 * notifications and the account menu. Pages are reached from the tab strip.
 */
export function DashboardNav({
  area,
  user,
}: {
  area: DashboardArea;
  user: { name?: string | null; email?: string | null; role: string };
}) {
  const merchant = area === "merchant";

  return (
    <header className="container-site fixed inset-x-0 top-0 z-50">
      <div className="my-2.5 rounded-2xl bg-white/30 p-1.5 backdrop-blur-md md:my-4">
        <nav
          aria-label="Dashboard"
          className="flex w-full items-center gap-2 rounded-xl border border-default-100 bg-white/90 px-3 py-2 md:px-4"
        >
          <Link
            href={AREA_HOME[area]}
            aria-label={area === "admin" ? "Admin overview" : "Dashboard overview"}
            className="flex shrink-0 items-center gap-2 pr-2"
          >
            <Logo markClassName="size-7" className="[&>span:last-child]:text-xl" />
            {area === "admin" && (
              <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                Admin
              </span>
            )}
          </Link>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {merchant && <PaymentSearch />}
            <NotificationBell area={area} />
            {merchant && (
              <Link
                href="/dashboard/payment-links/create"
                aria-label="New payment link"
                className="inline-flex size-10 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-deep sm:w-auto sm:px-4"
              >
                <Plus size={16} /> <span className="hidden sm:inline">New link</span>
              </Link>
            )}
            <AccountMenu area={area} user={user} />
          </div>
        </nav>

      </div>
    </header>
  );
}

/**
 * The payments list already filters on ?search= (id, customer email or
 * external id), so the navbar's search is a shortcut into it. Collapsed to an
 * icon until it's wanted.
 */
function PaymentSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useDismiss(open, formRef, () => setOpen(false));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
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
