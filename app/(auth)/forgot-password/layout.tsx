import { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Forgot password",
  description: "Reset your Crypteo password with a code sent to your email.",
  path: "/forgot-password",
  index: false,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
