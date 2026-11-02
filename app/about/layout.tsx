import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "About Our Decentralized Crypto Payment Gateway",
  description:
    "Crypteo is a decentralized, non-custodial and open source crypto payment gateway. Buyers pay your own wallet directly; we never hold your keys or funds.",
  path: "/about",
});

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
