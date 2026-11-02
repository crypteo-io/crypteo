import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Reset password",
  description: "Choose a new password for your Crypteo account.",
  path: "/reset-password",
  index: false,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
