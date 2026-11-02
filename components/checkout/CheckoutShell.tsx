import { MerchantLogo } from "@/components/checkout/MerchantLogo";
import { Logo } from "@/components/site/Logo";
import { checkoutPaletteStyle, PLATFORM_SUPPORT_EMAIL, type CheckoutBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { CheckoutContactProvider } from "@/components/checkout/CheckoutContact";
import { ExternalLink, Mail } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

const POWERED_BY_URL = "https://crypteo.io/?ref=checkout";

/**
 * Page chrome for the hosted checkout: sky backdrop washed to white, themed with the merchant's colour, and the
 * support contact below the card. On a phone the merchant's logo (or, without
 * one, the Crypteo mark) sits above the card; on desktop it moves into the
 * card's summary panel.
 */
export function CheckoutShell({
  branding,
  children,
}: {
  branding?: CheckoutBranding | null;
  children: ReactNode;
}) {
  return (
    <div
      className="relative isolate min-h-screen overflow-x-clip"
      style={checkoutPaletteStyle(branding?.color ?? null)}
    >
      <div aria-hidden="true" className="fixed inset-0 -z-10">
        <Image
          src="/bg/section-bg-2.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-top opacity-80"
        />
        <div className="absolute inset-0 bg-linear-to-b from-white/30 via-white/75 to-white" />
      </div>

      <CheckoutColumn branding={branding} className="px-4 pt-6 pb-10 sm:pt-12 lg:pt-20">
        {children}
      </CheckoutColumn>
    </div>
  );
}

/**
 * The checkout card's column: the phone-only logo above it, the merchant's
 * contact (and, if they chose it, "Powered by Crypteo") below. Also used by
 * the demo checkouts (components/checkout/DemoCheckout.tsx).
 */
export function CheckoutColumn({
  branding,
  className,
  children,
}: {
  branding?: CheckoutBranding | null;
  className?: string;
  children: ReactNode;
}) {
  const supportEmail = branding?.supportEmail || PLATFORM_SUPPORT_EMAIL;
  const item = "inline-flex min-h-11 items-center gap-1.5 font-semibold text-ck-ink underline-offset-2 hover:underline";
  return (
    <div className={cn("mx-auto flex w-full max-w-[560px] flex-col items-center lg:max-w-[1040px]", className)}>
      {branding?.logoUrl ? (
        <MerchantLogo
          src={branding.logoUrl}
          name={branding.name}
          className="mb-6 max-h-10 max-w-[200px] sm:mb-8 lg:hidden"
        />
      ) : (
        <Logo className="mb-6 sm:mb-8 lg:hidden" markClassName="size-8" />
      )}
      <CheckoutContactProvider email={supportEmail}>
        <div className="w-full">{children}</div>
      </CheckoutContactProvider>
      <footer className="mt-6 flex flex-col items-center gap-1 text-sm text-default-600">
        <div className="flex flex-wrap items-center justify-center gap-x-5">
          <span className="text-default-500">Need help?</span>
          <a href={`mailto:${supportEmail}`} className={item}>
            <Mail size={15} aria-hidden="true" className="shrink-0" />
            {supportEmail}
          </a>
          {branding?.contact && (
            <a href={branding.contact.url} target="_blank" rel="noopener noreferrer nofollow" className={item}>
              <ExternalLink size={15} aria-hidden="true" className="shrink-0" />
              {branding.contact.label}
            </a>
          )}
        </div>
        {branding?.poweredBy && (
          <a
            href={POWERED_BY_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-9 items-center gap-1.5 text-[13px] text-default-500 hover:text-default-900"
          >
            Powered by <Logo className="gap-1 [&>span:last-child]:text-[14px]" markClassName="size-4" />
          </a>
        )}
      </footer>
    </div>
  );
}
