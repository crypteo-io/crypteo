"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { apiRequest } from "@/lib/api-client";
import { copyWithToast, toast } from "@/lib/toast";
import { LocalDate } from "@/components/ui/LocalDate";
import { cn } from "@/lib/utils";
import { PaymentLink } from "@/types/payment";
import gsap from "gsap";
import {
    Copy, Link as LinkIcon, MoreVertical, Plus, Power,
    PowerOff, Trash
} from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "./PageHeader";

export function PaymentLinksClient({
  initialLinks,
  renderedAt,
  domainCard,
  telegramCard,
}: {
  initialLinks: PaymentLink[];
  /** The custom domain card, rendered on the server's data. */
  domainCard: ReactNode;
  telegramCard: ReactNode;
  // Server clock at render time (ms). Expiry is judged against it rather than
  // the browser clock so the first client render matches the server HTML —
  // reading `new Date()` here mismatched at the expiry boundary or whenever
  // the viewer's clock was skewed. A reload re-evaluates it.
  renderedAt: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState(initialLinks);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const confirm = useConfirm();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

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
  }, [links]);

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    setMenuOpenId(null);
    const link = links.find((l) => l.id === id);
    if (currentStatus) {
      const ok = await confirm({
        title: "Deactivate this link?",
        description: `"${link?.title ?? "This link"}" stops opening new checkouts. Checkouts already started keep being watched.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (!ok) return;
    }
    try {
      await toast.promise(
        apiRequest(`/api/payment-links/${id}`, { method: "PATCH", body: { isActive: !currentStatus } }),
        {
          loading: currentStatus ? "Deactivating…" : "Activating…",
          success: currentStatus ? "Link deactivated" : "Link activated",
          error: "Link not changed",
        },
      );
      setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, isActive: !currentStatus } : l)));
    } catch {
      // The toast already says why.
    }
  };

  const deleteLink = async (id: string) => {
    setMenuOpenId(null);
    const link = links.find((l) => l.id === id);
    const ok = await confirm({
      title: "Delete this payment link?",
      description: `Anyone opening "${link?.title ?? "this link"}" will see that it no longer exists. Payments already made through it are kept.`,
      confirmLabel: "Delete link",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await toast.promise(apiRequest(`/api/payment-links/${id}`, { method: "DELETE" }), {
        loading: "Deleting link…",
        success: "Payment link deleted",
        error: "Link not deleted",
      });
      setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch {
      // The toast already says why.
    }
  };

  const copyUrl = async (id: string, url: string) => {
    setMenuOpenId(null);
    if (await copyWithToast(url, "Payment link copied")) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const activeCount = links.filter((l) => {
    const expired = l.expiresAt && new Date(l.expiresAt).getTime() < renderedAt;
    const finished = l.paymentLimit && l.paymentsCount >= l.paymentLimit;
    return l.isActive && !expired && !finished;
  }).length;

  return (
    <div ref={containerRef} className="space-y-8 pb-12">
      <div className="animate-up">
        <PageHeader
          title="Payment links"
          subtitle={`${links.length} link${links.length === 1 ? "" : "s"}, ${activeCount} accepting payments`}
          actions={
            <Link
              href="/dashboard/payment-links/create"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-aigocy-dark transition-colors hover:bg-primary-deep"
            >
              <Plus size={16} /> New link
            </Link>
          }
        />
      </div>

      {links.length === 0 ? (
        <div className="frame animate-up">
          <div className="frame-inner flex flex-col items-center px-6 py-16 text-center">
            <div className="icon-tile size-14 mb-4">
              <LinkIcon className="text-default-500" size={24} />
            </div>
            <p className="font-heading text-[16px] font-semibold text-default-950">No payment links yet</p>
            <p className="mt-1 max-w-sm text-[14px] text-default-500">
              A link is a hosted checkout you can share anywhere: email, chat or a button on your site.
            </p>
            <Link
              href="/dashboard/payment-links/create"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-primary-deep"
            >
              <Plus size={16} /> Create your first link
            </Link>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {links.map((link) => {
            const isExpired =
              link.expiresAt &&
              new Date(link.expiresAt).getTime() < renderedAt;
            const isFinished =
              link.paymentLimit &&
              link.paymentsCount >= link.paymentLimit;
            const active = link.isActive && !isExpired && !isFinished;

            return (
              <li key={link.id} className="frame animate-up">
              <div
                className="frame-inner relative flex h-full flex-col p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "flex size-12 items-center justify-center rounded-xl",
                      active ? "bg-sky/8 text-sky" : "bg-default-100 text-default-500",
                    )}
                  >
                    <LinkIcon size={22} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-semibold",
                        active
                          ? "border-accent-green/15 bg-accent-green/5 text-accent-green"
                          : "border-default-200 bg-default-100 text-default-500",
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", active ? "bg-accent-green" : "bg-default-400")}
                      />
                      {active
                        ? "Active"
                        : isExpired
                          ? "Expired"
                          : isFinished
                            ? "Completed"
                            : "Inactive"}
                    </span>
                    <button
                      onClick={() =>
                        setMenuOpenId(menuOpenId === link.id ? null : link.id)
                      }
                      aria-label={`Actions for ${link.title}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === link.id}
                      className="rounded-lg p-1.5 text-default-500 transition-colors hover:bg-default-100 hover:text-default-900 cursor-pointer"
                    >
                      <MoreVertical size={18} />
                    </button>
                  </div>
                </div>

                {menuOpenId === link.id && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpenId(null)}
                    />
                    <div
                      role="menu"
                      className="absolute right-4 top-14 z-50 w-48 rounded-xl border border-default-200 bg-white py-1.5 shadow-card-hover"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        role="menuitem"
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-default-700 transition-colors hover:bg-default-50"
                      >
                        <LinkIcon size={16} /> Visit link
                      </a>
                      <button
                        role="menuitem"
                        onClick={() => toggleStatus(link.id, link.isActive)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-default-700 transition-colors hover:bg-default-50 cursor-pointer"
                      >
                        {link.isActive ? (
                          <>
                            <PowerOff size={16} /> Deactivate
                          </>
                        ) : (
                          <>
                            <Power size={16} /> Activate
                          </>
                        )}
                      </button>
                      <div className="mx-4 my-1 h-px bg-default-100" />
                      <button
                        role="menuitem"
                        onClick={() => deleteLink(link.id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-[13px] font-semibold text-accent-red transition-colors hover:bg-accent-red/5 cursor-pointer"
                      >
                        <Trash size={16} /> Delete link
                      </button>
                    </div>
                  </>
                )}

                <h2 className="mt-4 truncate font-heading text-[17px] font-semibold text-default-950">
                  {link.title}
                </h2>
                <p className="text-[12px] text-default-500">
                  Created{" "}
                  <LocalDate
                    value={link.createdAt}
                    options={{ month: "short", day: "numeric", year: "numeric" }}
                  />
                </p>
                {link.webhookDestination && (
                  <p
                    className="mt-1 truncate text-[12px] text-default-500"
                    title={link.webhookUrl ?? undefined}
                  >
                    Webhooks go to {link.webhookDestination}
                  </p>
                )}

                <dl className="mt-5 flex items-end justify-between gap-4">
                  <div>
                    <dt className="text-[12px] text-default-500">Amount</dt>
                    <dd className="font-heading text-[20px] font-semibold tabular-nums text-default-950">
                      ${link.amount.toFixed(2)}
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-[12px] text-default-500">Payments</dt>
                    <dd className="font-heading text-[20px] font-semibold tabular-nums text-default-950">
                      {link.paymentsCount}
                      <span className="text-[14px] font-medium text-default-400">
                        {" "}/ {link.paymentLimit || "∞"}
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-center gap-2 rounded-xl border border-default-200 bg-default-50 py-1.5 pl-3 pr-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-default-600">
                    {link.url}
                  </span>
                  <button
                    onClick={() => copyUrl(link.id, link.url)}
                    aria-label="Copy link"
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold transition-colors cursor-pointer",
                      copiedId === link.id
                        ? "text-accent-green"
                        : "text-default-600 hover:bg-white hover:text-default-950",
                    )}
                  >
                    <Copy size={13} /> {copiedId === link.id ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="animate-up">{domainCard}</div>
      {telegramCard && <div className="animate-up">{telegramCard}</div>}
    </div>
  );
}
