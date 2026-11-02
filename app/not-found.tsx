import { ButtonLink } from "@/components/site/Button";
import { Logo } from "@/components/site/Logo";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
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
