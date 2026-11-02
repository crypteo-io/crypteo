import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Verify your email",
  description: "Confirm your email address to finish setting up your Crypteo account.",
  path: "/verify",
  index: false,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
