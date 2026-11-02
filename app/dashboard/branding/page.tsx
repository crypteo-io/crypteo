import { BrandingClient } from "@/components/dashboard/BrandingClient";
import { auth } from "@/lib/auth";
import { brandLogoUrl } from "@/lib/branding";
import { prisma } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout branding",
  description: "Put your logo and colour on the hosted checkout.",
};

export default async function BrandingPage() {
  const session = await auth();
  if (!session?.user) return null;

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      brandColor: true,
      logo: { select: { id: true } },
      supportEmail: true,
      supportLinkLabel: true,
      supportLinkUrl: true,
      showPoweredBy: true,
    },
  });
  if (!merchant) return null;

  return (
    <BrandingClient
      merchantName={merchant.name}
      initialColor={merchant.brandColor}
      initialLogoUrl={merchant.logo ? brandLogoUrl(merchant.logo.id) : null}
      initialFooter={{
        supportEmail: merchant.supportEmail ?? "",
        supportLinkLabel: merchant.supportLinkLabel ?? "",
        supportLinkUrl: merchant.supportLinkUrl ?? "",
        showPoweredBy: merchant.showPoweredBy,
      }}
    />
  );
}
