import { LogoMark } from "@/components/site/Logo";
import { cn } from "@/lib/utils";
import { AlertCircle, ArrowLeft, CheckCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** Shared label style for every auth form field. */
export const AUTH_LABEL = "mb-1.5 block font-medium text-default-900";

/** Underlined footer link, as in the template's auth pages. */
export const AUTH_LINK = "font-semibold text-default-900 underline underline-offset-2 hover:text-sky";

/** Full-viewport sky backdrop with the back-home link and a centred column for the card. */
export function AuthScreen({
  children,
  homeLink = true,
}: {
  children: ReactNode;
  /** Off on the admin host, which has no public home to go back to. */
  homeLink?: boolean;
}) {
  return (
    <main className="relative isolate flex min-h-dvh flex-col px-4 py-5 md:py-8">
      <Image
        src="/bg/section-bg-2.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover"
      />
      {homeLink && (
      <div className="mx-auto w-full max-w-120 md:absolute md:top-8 md:left-8 md:mx-0 md:w-auto">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-default-900 backdrop-blur-sm transition-colors hover:bg-white"
        >
          <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-0.5" />
          Back to home
        </Link>
      </div>
      )}
      <div className="my-auto w-full pt-5 md:pt-16">
        <div className="mx-auto w-full max-w-120">{children}</div>
      </div>
    </main>
  );
}

/** The template's frosted frame around a white card. */
export function AuthFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="rounded-[22px] border border-white/40 bg-white/25 p-2 backdrop-blur sm:p-2.5">
      <div className={cn("rounded-2xl bg-white p-6 sm:p-8 md:p-10", className)}>{children}</div>
    </div>
  );
}

/**
 * Card header: icon tile (Crypteo mark by default), left-aligned heading and a
 * one-line description. `top` renders above the tile (signup's wallet notice).
 */
export function AuthCard({
  title,
  description,
  icon,
  top,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  top?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AuthFrame>
      {top && <div className="mb-7">{top}</div>}
      <div className="icon-tile mb-6 size-14 text-sky">{icon ?? <LogoMark className="size-8" />}</div>
      <h1 className="text-[28px] leading-tight tracking-[-0.02em] md:text-3xl">{title}</h1>
      {description && <p className="mt-2 break-words text-default-600">{description}</p>}
      <div className="mt-7">{children}</div>
    </AuthFrame>
  );
}

/** Placeholder card while a search-param-reading form suspends. */
export function AuthCardSkeleton() {
  return (
    <AuthFrame className="animate-pulse">
      <div className="mb-6 size-14 rounded-xl bg-default-100" />
      <div className="h-8 w-2/3 rounded-lg bg-default-100" />
      <div className="mt-3 h-4 w-full rounded bg-default-100" />
      <div className="mt-8 h-12.5 rounded-xl bg-default-100" />
      <div className="mt-4 h-12.5 rounded-xl bg-default-100" />
    </AuthFrame>
  );
}

export function AuthAlert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success";
  children: ReactNode;
}) {
  const error = tone === "error";
  const Icon = error ? AlertCircle : CheckCircle;
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "mb-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium",
        error
          ? "border-accent-red/20 bg-accent-red/5 text-accent-red"
          : "border-accent-green/20 bg-accent-green/5 text-accent-green",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

/** Spinner for busy submit buttons. */
export function AuthSpinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />;
}

/** "Remember this device": opts this browser into skipping the code (lib/trusted-device.ts). */
export function RememberDevice({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm font-medium text-default-900">
      <input
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      Remember this device
    </label>
  );
}
