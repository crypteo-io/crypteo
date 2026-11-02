import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Create an Account",
  description:
    "Create your Crypteo account and start accepting non-custodial crypto payments in minutes, paid straight to your own wallet with no middleman.",
  path: "/register",
});

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
