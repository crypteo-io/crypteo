import { adminOrigin, siteOrigin } from "./admin-host";

// A merchant's own hostname (pay.shop.com, CNAME to us) serves their payment
// links and checkouts, nothing else. Pure, so proxy.ts can use it; ownership
// checks against DNS live in lib/custom-domain.ts.

/** "Pay.Shop.com:443" → "pay.shop.com". */
export const hostnameOf = (host: string | null | undefined) => (host ?? "").toLowerCase().replace(/:\d+$/, "");

const IP = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/;

export const siteHostname = () => new URL(siteOrigin()).hostname;

/** Our own hostnames: the site, its www, the admin host and every subdomain of the site. */
export function isPlatformHostname(hostname: string): boolean {
  const site = siteHostname();
  return hostname === site || hostname.endsWith(`.${site}`) || hostname === new URL(adminOrigin()).hostname;
}

/**
 * A request to someone else's hostname. Internal names (docker service names,
 * localhost, bare IPs from health checks) are never custom: they are us.
 */
export function isCustomHost(host: string | null | undefined): boolean {
  const name = hostnameOf(host);
  return name.includes(".") && !IP.test(name) && name !== "localhost" && !name.endsWith(".localhost") && !isPlatformHostname(name);
}

const CUSTOM_HOST_PATHS = [
  /^\/pay\/[^/]+$/,
  /^\/checkout\/[^/]+(?:\/pay)?$/,
  /^\/api\/payments\/[^/]+(?:\/simulate)?$/,
  /^\/api\/brand-logo\/[^/]+$/,
  /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/,
];

/** The only paths a custom host answers: a payment link, its checkout and what they load. */
export const isCustomHostPath = (pathname: string) => CUSTOM_HOST_PATHS.some((p) => p.test(pathname));

/** Prisma `select` for servesHost and paymentLinkUrl. */
export const HOST_MERCHANT_SELECT = { customDomain: true, customDomainVerifiedAt: true } as const;

/** Owned and verified: the merchant whose payment pages this hostname may serve. */
export function servesHost(
  merchant: { customDomain: string | null; customDomainVerifiedAt: Date | null },
  host: string | null | undefined,
): boolean {
  return !isCustomHost(host) || (!!merchant.customDomainVerifiedAt && merchant.customDomain === hostnameOf(host));
}

/** A payment link's public URL: on the merchant's verified domain when they have one. */
export function paymentLinkUrl(
  linkId: string,
  merchant: { customDomain: string | null; customDomainVerifiedAt: Date | null },
): string {
  const origin = merchant.customDomain && merchant.customDomainVerifiedAt ? `https://${merchant.customDomain}` : siteOrigin();
  return `${origin}/pay/${linkId}`;
}
