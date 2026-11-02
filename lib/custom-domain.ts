import crypto from "crypto";
import { resolveTxt } from "dns/promises";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { BRANDING_MERCHANT_SELECT, toCheckoutBranding, type CheckoutBranding } from "./branding";
import { hostnameOf, isCustomHost, isPlatformHostname, servesHost, siteHostname } from "./custom-host";
import { prisma } from "./db";

// Custom domains for payment links (Payment links page). A merchant adds a
// subdomain of theirs, proves they own it with a TXT record, and points it at
// us with a CNAME. Caddy (caddy/Caddyfile) obtains its certificate on demand,
// once GET /api/custom-domains/allowed confirms the domain is verified.

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * A subdomain such as pay.shop.com: apex domains can't carry a CNAME, and our
 * own hostnames are never a merchant's.
 */
export const customDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, ""))
  .refine((v) => {
    const labels = v.split(".");
    return labels.length >= 3 && labels.every((l) => LABEL.test(l)) && /[a-z]/.test(labels[labels.length - 1]);
  }, "Enter a subdomain you own, such as pay.yourstore.com")
  .refine((v) => !isPlatformHostname(v), "That hostname belongs to Crypteo");

/** A page of this merchant's requested on a hostname that isn't theirs (another merchant's, or unverified). */
export async function onForeignHost(merchant: Parameters<typeof servesHost>[0]): Promise<boolean> {
  return !servesHost(merchant, (await headers()).get("host"));
}

/** The verified merchant whose domain this request is on; null on our own hosts. One query per request. */
export const customHostMerchant = cache(async (): Promise<CheckoutBranding | null> => {
  const host = (await headers()).get("host");
  if (!isCustomHost(host)) return null;
  const merchant = await prisma.merchant.findFirst({
    where: { customDomain: hostnameOf(host), customDomainVerifiedAt: { not: null }, isActive: true },
    select: BRANDING_MERCHANT_SELECT,
  });
  return merchant ? toCheckoutBranding(merchant) : null;
});

/**
 * A page's metadata on a merchant's own domain: titled after the merchant, and
 * without the platform's inherited description and share tags.
 */
export async function hostMetadata(title: string): Promise<Metadata> {
  const merchant = await customHostMerchant();
  if (!merchant) return { title };
  return { title: { absolute: `${title} | ${merchant.name}` }, description: null, openGraph: null, twitter: null };
}

/** Where merchants point their CNAME. */
export const cnameTarget = () => process.env.CUSTOM_DOMAIN_TARGET || `domains.${siteHostname()}`;

export const verificationName = (domain: string) => `_crypteo-verify.${domain}`;
export const verificationValue = (token: string) => `crypteo-verify=${token}`;
export const newVerificationToken = () => crypto.randomBytes(18).toString("base64url");

/** Whether the domain's TXT record carries this token. A lookup failure is "not yet", never a pass. */
export async function hasVerificationRecord(domain: string, token: string): Promise<boolean> {
  const records = await resolveTxt(verificationName(domain)).catch(() => []);
  const expected = verificationValue(token);
  return records.some((chunks) => chunks.join("") === expected);
}
