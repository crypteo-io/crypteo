import { cn } from "@/lib/utils";
import Image from "next/image";
import type { ReactNode } from "react";

/** The template's inner-page header: sky backdrop fading into white, big centred title. */
export function PageHero({
  title,
  subtitle,
  eyebrow,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("relative isolate overflow-hidden pt-32 pb-12 md:pt-40 md:pb-20 lg:pt-50", className)}
    >
      <SkyBackdrop />
      {/* Anchored to the bottom edge: SkyBackdrop's blur sits at a percentage of
          the height, so a taller hero (buttons under the subtitle) clipped it
          into a hard line. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-b from-white/0 to-white" />
      <div className="container-site">
        <div className="mx-auto max-w-3xl text-center">
          {eyebrow && <div className="mb-5">{eyebrow}</div>}
          <h1 className="text-[40px] leading-[1.15] md:text-[64px]">{title}</h1>
          {subtitle && <p className="mx-auto mt-5 max-w-2xl text-lg text-default-700">{subtitle}</p>}
          {children}
        </div>
      </div>
    </section>
  );
}

/** Sky image under a section, washed to white at the bottom edge. */
export function SkyBackdrop({ src = "/bg/section-bg-1.webp" }: { src?: string }) {
  return (
    <>
      <Image src={src} alt="" fill priority sizes="100vw" className="-z-10 object-cover opacity-90" />
      <div className="absolute inset-x-[-10%] bottom-[-40%] -z-10 h-75 bg-white blur-2xl" />
    </>
  );
}

export function SectionHeading({
  title,
  subtitle,
  align = "center",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" ? "mx-auto text-center" : "", "max-w-2xl", className)}>
      <h2 className="text-[34px] leading-[1.15] md:text-[44px]">{title}</h2>
      {subtitle && <p className="mt-4 text-lg text-default-600">{subtitle}</p>}
    </div>
  );
}
