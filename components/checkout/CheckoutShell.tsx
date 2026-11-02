import { CheckoutColumn } from "@/components/checkout/CheckoutColumn";
import { checkoutPaletteStyle, type CheckoutBranding } from "@/lib/branding";
import { isCustomHost } from "@/lib/custom-host";
import { headers } from "next/headers";
import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Page chrome for the hosted checkout: sky backdrop washed to white, themed with the merchant's colour, and the
 * support contact below the card. On a phone the merchant's logo (or, without
 * one, the Crypteo mark, or on their own domain their name) sits above the card; on desktop it moves into the
 * card's summary panel.
 */
export async function CheckoutShell({
  branding,
  children,
}: {
  branding?: CheckoutBranding | null;
  children: ReactNode;
}) {
  const ownDomain = isCustomHost((await headers()).get("host"));
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

      <CheckoutColumn branding={branding} platformMark={!ownDomain} className="px-4 pt-6 pb-10 sm:pt-12 lg:pt-20">
        {children}
      </CheckoutColumn>
    </div>
  );
}
