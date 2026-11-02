"use client";

import { Button, ButtonLink } from "@/components/site/Button";
import { Logo } from "@/components/site/Logo";
import { RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4 py-16">
      <Link href="/" aria-label="Crypteo home" className="mb-10">
        <Logo />
      </Link>
      <div className="relative isolate w-full max-w-150 overflow-hidden rounded-2xl border border-default-300 bg-white">
        <Image src="/bg/section-bg-1.webp" alt="" fill priority sizes="600px" className="-z-10 object-cover" />
        <div className="flex flex-col gap-5 p-10 text-center lg:p-15">
          <h1 className="text-3xl lg:text-4xl">Something went wrong</h1>
          <p className="text-default-700">
            An unexpected error stopped this page from loading. Try again, and if it keeps happening, let us know.
          </p>
          {error.digest && (
            <p className="mx-auto rounded-xl border border-default-200 bg-white/70 px-4 py-2 font-mono text-xs text-default-600">
              Reference: {error.digest}
            </p>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Button onClick={reset} icon={<RotateCcw size={18} />}>
              Try again
            </Button>
            <ButtonLink href="/" variant="white">
              Back to home
            </ButtonLink>
          </div>
        </div>
      </div>
    </main>
  );
}
