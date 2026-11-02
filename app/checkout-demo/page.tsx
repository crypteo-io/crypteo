import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import CheckoutDemoClient from "./CheckoutDemoClient";

export const metadata: Metadata = pageMetadata({
  title: "Crypto Checkout Demo",
  description:
    "Put your store's name, logo and colour on Crypteo's hosted crypto checkout and click through it as a buyer. Runs entirely in your browser.",
  path: "/checkout-demo",
});

export default function CheckoutDemoPage() {
  return <CheckoutDemoClient />;
}
