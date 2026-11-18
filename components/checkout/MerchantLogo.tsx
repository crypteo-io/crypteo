import { cn } from "@/lib/utils";

/**
 * A merchant's checkout logo: their upload (resized and re-encoded at upload,
 * lib/branding-logo.ts, served with a year-long immutable cache, so
 * next/image would only add a second copy) or an https URL from the API call
 * (paymentBrandingSchema), which the buyer's browser loads without a referrer
 * so the logo's host never learns the checkout URL.
 */
export function MerchantLogo({
  src,
  name,
  className,
}: {
  src: string;
  name?: string | null;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      referrerPolicy="no-referrer"
      alt={name ? `${name} logo` : "Merchant logo"}
      className={cn("block h-auto w-auto object-contain", className)}
    />
  );
}
