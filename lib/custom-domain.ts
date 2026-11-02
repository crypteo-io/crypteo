import crypto from "crypto";
import { resolveTxt } from "dns/promises";
import { headers } from "next/headers";
import { z } from "zod";
import { isPlatformHostname, servesHost, siteHostname } from "./custom-host";

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
