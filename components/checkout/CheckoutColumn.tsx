import { CheckoutContactProvider } from "@/components/checkout/CheckoutContact";
import { MerchantLogo } from "@/components/checkout/MerchantLogo";
import { Logo } from "@/components/site/Logo";
import { PLATFORM_SUPPORT_EMAIL, type CheckoutBranding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { ExternalLink, Mail } from "lucide-react";
import type { ReactNode } from "react";

const POWERED_BY_URL = "https://crypteo.io/?ref=checkout";

/**
 * The checkout card's column: the phone-only logo above it, the merchant's
 * contact (and, if they chose it, "Powered by Crypteo") below. Also used by
 * the demo checkouts (components/checkout/DemoCheckout.tsx).
 */
export function CheckoutColumn({
  branding,
  platformMark = true,
  className,
  children,
}: {
  branding?: CheckoutBranding | null;
  /** False on the merchant's own domain: their name, never the Crypteo mark, stands in for a missing logo. */
  platformMark?: boolean;
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
      ) : platformMark ? (
        <Logo className="mb-6 sm:mb-8 lg:hidden" markClassName="size-8" />
      ) : (
        branding?.name && (
          <p className="mb-6 font-heading text-xl font-semibold text-default-950 sm:mb-8 lg:hidden">{branding.name}</p>
        )
      )}
      <CheckoutContactProvider email={supportEmail} platformMark={platformMark}>
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
