import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Crypteo REST API reference: create non-custodial crypto payments, track statuses, verify signed webhooks and test with sandbox keys.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
