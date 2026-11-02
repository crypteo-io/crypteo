import { MerchantLogo } from "@/components/checkout/MerchantLogo";
import { ButtonLink } from "@/components/site/Button";
import { Logo } from "@/components/site/Logo";
import { checkoutPaletteStyle } from "@/lib/branding";
import { customHostMerchant } from "@/lib/custom-domain";
import { isCustomHost } from "@/lib/custom-host";
import { Mail } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";

// Absolute: the 404 is also served on merchants' own domains, where the
// platform's name must not appear (a not-found page can't set its title per host).
export const metadata: Metadata = {
  title: { absolute: "Page not found" },
  description: null,
  openGraph: null,
  twitter: null,
  robots: { index: false },
};

export default async function NotFound() {
  if (isCustomHost((await headers()).get("host"))) return <MerchantNotFound />;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-16">
      <Link href="/" aria-label="Crypteo home" className="mb-10">
        <Logo />
      </Link>
      <div className="relative isolate w-full max-w-150 overflow-hidden rounded-2xl border border-default-300 bg-white">
        <Image src="/bg/section-bg-1.webp" alt="" fill priority sizes="600px" className="-z-10 object-cover" />
        <div className="flex flex-col gap-5 p-10 text-center lg:p-15">
          <p className="font-heading text-7xl font-semibold leading-none text-default-950 lg:text-8xl">404</p>
          <h1 className="text-3xl lg:text-4xl">Page not found</h1>
          <p className="mb-4 text-default-700">The page you are looking for doesn&apos;t exist or has been moved.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/">Back to home</ButtonLink>
            <ButtonLink href="/contact" variant="white">
              Contact support
            </ButtonLink>
          </div>
        </div>
      </div>
    </main>
  );
}

/** A merchant's own domain: their logo, colour and support contact, nothing of the platform's. */
async function MerchantNotFound() {
  const merchant = await customHostMerchant();
  const email = merchant?.supportEmail;
  return (
    <main
      style={checkoutPaletteStyle(merchant?.color ?? null)}
      className="flex min-h-screen flex-col items-center justify-center bg-default-50 px-4 py-16 text-center"
    >
      {merchant?.logoUrl ? (
        <MerchantLogo src={merchant.logoUrl} name={merchant.name} className="mb-10 max-h-12 max-w-[220px]" />
      ) : (
        merchant?.name && <p className="mb-10 font-heading text-2xl font-semibold text-default-950">{merchant.name}</p>
      )}
      <div className="w-full max-w-md rounded-2xl border border-default-200 bg-white p-10">
        <p className="font-heading text-6xl font-semibold leading-none text-ck-ink">404</p>
        <h1 className="mt-5 text-2xl">Page not found</h1>
        <p className="mt-3 text-default-600">
          This payment page doesn&apos;t exist or is no longer available. Check the link you were sent.
        </p>
        {email && (
          <a
            href={`mailto:${email}`}
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-ck px-5 font-semibold text-on-ck hover:bg-ck-deep"
          >
            <Mail size={16} aria-hidden="true" className="shrink-0" />
            Contact {merchant?.name}
          </a>
        )}
      </div>
    </main>
  );
}
