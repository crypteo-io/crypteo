import { DemoCheckout } from "@/components/checkout/DemoCheckout";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { auth } from "@/lib/auth";
import { BRANDING_MERCHANT_SELECT, toCheckoutBranding } from "@/lib/branding";
import { prisma } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout preview",
  description: "Your hosted checkout with your saved branding, on sample data.",
};

export default async function BrandingPreviewPage() {
  const session = await auth();
  if (!session?.user) return null;
  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: BRANDING_MERCHANT_SELECT,
  });
  if (!merchant) return null;

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Checkout preview"
        subtitle="Your saved logo, colour and footer on the real checkout. Click through it as a buyer would: nothing is charged and no payment is created."
        backHref="/dashboard/branding"
        backLabel="Checkout branding"
      />
      <DemoCheckout
        branding={toCheckoutBranding(merchant)}
        title="Sample order"
        description="What a buyer sees when they open one of your checkouts."
        amountUsd={49}
      />
    </div>
  );
}
