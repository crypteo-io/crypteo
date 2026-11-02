import { cn } from "@/lib/utils";

/**
 * A merchant's uploaded checkout logo. A plain img: the file is already
 * resized and re-encoded at upload (lib/branding-logo.ts) and served with a
 * year-long immutable cache, so next/image would only add a second copy.
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
      alt={name ? `${name} logo` : "Merchant logo"}
      className={cn("block h-auto w-auto object-contain", className)}
    />
  );
}
