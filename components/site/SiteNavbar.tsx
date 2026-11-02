"use client";

import { SOLUTIONS } from "@/lib/content/solution-links";
import { cn } from "@/lib/utils";
import { ChevronDown, Menu, X } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ButtonLink } from "./Button";
import { Logo } from "./Logo";

const NAV_LINKS = [
  { label: "Pricing", href: "/pricing" },
  { label: "API", href: "/docs" },
  { label: "Blog", href: "/blog" },
  { label: "FAQ", href: "/faq" },
  { label: "About", href: "/about" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const inSolutions = (pathname: string) => SOLUTIONS.some((s) => s.path === pathname);

/** Moves focus between the menu's links with the arrow keys, Home and End. */
function moveFocus(container: HTMLElement | null, key: string) {
  const links = Array.from(container?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
  if (!links.length) return;
  const at = links.findIndex((l) => l === document.activeElement);
  const next =
    key === "Home" ? 0 : key === "End" ? links.length - 1 : key === "ArrowDown" ? (at + 1) % links.length : (at - 1 + links.length) % links.length;
  links[next].focus();
}

const MENU_KEYS = ["ArrowDown", "ArrowUp", "Home", "End"];

/** Desktop "Solutions" disclosure: opens on click or ArrowDown, closes on Escape, outside click or tabbing away. */
function SolutionsMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusFirst = useRef(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    if (focusFirst.current) {
      focusFirst.current = false;
      moveFocus(panel.current, "Home");
    }
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapper.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onButtonKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    if (open) moveFocus(panel.current, "Home");
    else {
      focusFirst.current = true;
      setOpen(true);
    }
  };

  const onPanelKey = (e: ReactKeyboardEvent) => {
    if (!MENU_KEYS.includes(e.key)) return;
    e.preventDefault();
    moveFocus(panel.current, e.key);
  };

  return (
    <div
      ref={wrapper}
      className="relative"
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKey}
        className={cn(
          "inline-flex items-center gap-1 px-4 py-2.5 font-medium transition-colors hover:text-primary",
          open || inSolutions(pathname) ? "text-primary" : "text-default-600",
        )}
      >
        Solutions
        <ChevronDown size={16} className={cn("transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        onKeyDown={onPanelKey}
        className="absolute top-full left-1/2 mt-3 w-[600px] -translate-x-1/2 rounded-2xl border border-default-100 bg-white p-2.5 shadow-[0_20px_50px_-12px_rgba(6,15,22,0.25)]"
      >
        <ul className="grid grid-cols-2 gap-1">
          {SOLUTIONS.map((s) => (
            <li key={s.key}>
              <Link
                href={s.path}
                onClick={() => setOpen(false)}
                aria-current={pathname === s.path ? "page" : undefined}
                className="block rounded-xl px-4 py-3 transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none"
              >
                <span className={cn("block font-medium", pathname === s.path ? "text-primary" : "text-default-950")}>
                  {s.label}
                </span>
                <span className="mt-0.5 block text-sm font-normal text-default-600">{s.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The mobile menu's Solutions group, collapsed until asked for. */
function MobileSolutions({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(inSolutions(pathname));
  const listId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-4 py-3 font-medium hover:bg-primary/5",
          inSolutions(pathname) ? "text-primary" : "text-default-700",
        )}
      >
        Solutions
        <ChevronDown size={18} className={cn("transition-transform duration-200", open && "rotate-180")} />
      </button>
      <ul id={listId} hidden={!open} className="mb-1 ml-4 border-l border-default-100 pl-2">
        {SOLUTIONS.map((s) => (
          <li key={s.key}>
            <Link
              href={s.path}
              onClick={onNavigate}
              aria-current={pathname === s.path ? "page" : undefined}
              className={cn(
                "block rounded-lg px-4 py-2.5 hover:bg-primary/5",
                pathname === s.path ? "text-primary" : "text-default-700",
              )}
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function SiteNavbar() {
  const pathname = usePathname();
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const signedIn = status === "authenticated";

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <header className="container-site max-w-245! fixed inset-x-0 top-0 z-50">
      <div className="my-2.5 rounded-2xl bg-white/20 p-1.5 backdrop-blur-sm md:my-5 lg:my-8">
        <nav
          aria-label="Main"
          className="flex w-full items-center justify-between rounded-xl border border-default-100 bg-white/85 px-4 py-2.5 md:px-5"
        >
          <Link href="/" aria-label="Crypteo home" onClick={() => setOpen(false)}>
            <Logo markClassName="size-7" className="[&>span:last-child]:text-xl" />
          </Link>

          <div className="mx-auto hidden items-center lg:flex">
            <SolutionsMenu pathname={pathname} />
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
                className={cn(
                  "px-4 py-2.5 font-medium transition-colors hover:text-primary",
                  isActive(pathname, link.href) ? "text-primary" : "text-default-600",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            {signedIn ? (
              <ButtonLink href="/dashboard" size="sm">
                Dashboard
              </ButtonLink>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-2.5 font-medium text-default-600 transition-colors hover:text-primary"
                >
                  Log in
                </Link>
                <ButtonLink href="/register" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}
          </div>

          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg text-default-900 hover:bg-default-100 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>

        {open && (
          <div
            id="mobile-menu"
            className="mt-1.5 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-default-100 bg-white p-2 lg:hidden"
          >
            <MobileSolutions pathname={pathname} onNavigate={() => setOpen(false)} />
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-lg px-4 py-3 font-medium hover:bg-primary/5",
                  isActive(pathname, link.href) ? "text-primary" : "text-default-700",
                )}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/contact"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-4 py-3 font-medium text-default-700 hover:bg-primary/5"
            >
              Contact
            </Link>
            <div className="mt-2 grid gap-2 border-t border-default-100 pt-3">
              {signedIn ? (
                <ButtonLink href="/dashboard" onClick={() => setOpen(false)}>
                  Dashboard
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink href="/login" variant="white" onClick={() => setOpen(false)}>
                    Log in
                  </ButtonLink>
                  <ButtonLink href="/register" onClick={() => setOpen(false)}>
                    Get started
                  </ButtonLink>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
