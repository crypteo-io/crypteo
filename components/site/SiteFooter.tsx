import { SOLUTIONS } from "@/lib/content/solution-links";
import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "./Button";
import { Logo } from "./Logo";

const COLUMNS = [
  {
    title: "Solutions",
    links: SOLUTIONS.map((s) => ({ label: s.label, href: s.path })),
  },
  {
    title: "Product",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "API reference", href: "/docs" },
      { label: "Checkout demo", href: "/checkout-demo" },
      { label: "API playground", href: "/playground" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "FAQ", href: "/faq" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="relative isolate mt-10 overflow-hidden pt-44 md:pt-52 lg:pt-64">
      <Image
        src="/bg/footer-bg.webp"
        alt=""
        fill
        sizes="100vw"
        className="-z-10 object-cover object-bottom opacity-60"
      />
      <div className="absolute inset-x-[-10%] top-[-30%] -z-10 h-125 bg-white blur-2xl" />
      <Image
        src="/bg/decoration-5.webp"
        alt=""
        width={540}
        height={315}
        className="pointer-events-none absolute -z-10 top-[38%] left-[2%] w-75 opacity-40"
      />
      <Image
        src="/bg/decoration-1.webp"
        alt=""
        width={600}
        height={350}
        className="pointer-events-none absolute -z-10 top-[44%] -right-8 w-100 opacity-80"
      />

      <div className="container-site pb-10">
        <div className="rounded-2xl border border-white/30 bg-linear-to-b from-white/30 to-transparent p-2.5">
          <div className="rounded-2xl bg-linear-to-b from-white/80 to-white/30 p-7 md:p-12 lg:p-15">
            <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-6 lg:gap-12">
              <div className="flex flex-col gap-6 sm:col-span-2">
                <Logo markClassName="size-9" className="[&>span:last-child]:text-[28px]" />
                <p className="max-w-sm text-default-700">
                  Decentralised payment gateway. Buyers pay your own wallet directly, so there is no
                  processor balance to freeze and no exchange in the middle.
                </p>
                <div>
                  <ButtonLink href="/register">Start accepting crypto</ButtonLink>
                </div>
              </div>

              {COLUMNS.map((col) => (
                <div key={col.title}>
                  <h3 className="mb-5 text-lg font-medium">{col.title}</h3>
                  <ul className="space-y-2.5">
                    {col.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="text-default-600 transition-colors hover:text-primary"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <hr className="mt-12 mb-7 border-default-200/70" />
            <div className="flex flex-col justify-between gap-3 text-sm text-default-600 sm:flex-row">
              <p>© {new Date().getFullYear()} Crypteo. All rights reserved.</p>
              <a href="mailto:support@crypteo.io" className="hover:text-primary">
                support@crypteo.io
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
