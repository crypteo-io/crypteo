import { Logo } from "@/components/site/Logo";
import Image from "next/image";
import type { ReactNode } from "react";
import { DashboardNav } from "./DashboardNav";
import type { DashboardArea } from "./nav-items";
import { SectionTabs } from "./SectionTabs";

/**
 * The frame both dashboards share, built like the landing page: a floating
 * navbar over a sky header that washes into a white page, the section's tabs,
 * then the page.
 */
export function DashboardShell({
  area,
  user,
  banner,
  children,
}: {
  area: DashboardArea;
  user: { name?: string | null; email?: string | null; role: string };
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-white font-body text-default-600">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[440px] overflow-hidden">
        <Image src="/bg/section-bg-1.webp" alt="" fill priority sizes="100vw" className="object-cover object-top opacity-80" />
        <div className="absolute inset-0 bg-linear-to-b from-white/10 via-white/50 to-white" />
      </div>
      <DashboardNav area={area} user={user} />
      <main className="container-site flex-1 pt-26 pb-16 md:pt-32">
        <SectionTabs area={area} />
        {banner}
        {children}
      </main>
      <footer className="border-t border-default-100">
        <div className="container-site flex flex-wrap items-center justify-between gap-3 py-6 text-[13px] text-default-500">
          <Logo markClassName="size-5" className="gap-2 [&>span:last-child]:text-[15px]" />
          <p>{area === "admin" ? "Admin console" : "Decentralised payment gateway"}</p>
        </div>
      </footer>
    </div>
  );
}
