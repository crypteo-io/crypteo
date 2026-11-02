import crypto from "crypto";
import { resolveTxt } from "dns/promises";
import { headers } from "next/headers";
import { z } from "zod";
import { isPlatformHostname, servesHost, siteHostname } from "./custom-host";

// Custom domains for payment links (Payment links page). A merchant adds a
// subdomain of theirs, proves they own it with a TXT record, and points it at
// us with a CNAME. TLS for it comes from Cloudflare for SaaS when configured
// (CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN); a self-hosted instance can let
// its proxy issue certificates on demand for verified domains instead
// (GET /api/custom-domains/allowed).

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

const CF_API = "https://api.cloudflare.com/client/v4";

function cloudflare(): { zone: string; token: string } | null {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  return zone && token ? { zone, token } : null;
}

const cfResponse = z.object({ success: z.boolean(), result: z.unknown().optional() });

/** One Cloudflare zone call; unconfigured (self-hosted) counts as success. Never throws. */
async function cf(path: string, init: RequestInit = {}): Promise<z.infer<typeof cfResponse>> {
  const conf = cloudflare();
  if (!conf) return { success: true };
  try {
    const res = await fetch(`${CF_API}/zones/${encodeURIComponent(conf.zone)}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${conf.token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const parsed = cfResponse.safeParse(await res.json());
    return parsed.success ? parsed.data : { success: false };
  } catch {
    return { success: false };
  }
}

/** Asks Cloudflare for SaaS to serve and certify the hostname. */
export async function registerHostname(domain: string): Promise<boolean> {
  const res = await cf("/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({ hostname: domain, ssl: { method: "http", type: "dv" } }),
  });
  return res.success || (await hostnameIds(domain)).length > 0;
}

async function hostnameIds(domain: string): Promise<string[]> {
  const found = await cf(`/custom_hostnames?hostname=${encodeURIComponent(domain)}`);
  const ids = z.array(z.object({ id: z.string() })).safeParse(found.result);
  return ids.success ? ids.data.map((h) => h.id) : [];
}

/** Removes the hostname from Cloudflare for SaaS, if it was there. */
export async function unregisterHostname(domain: string): Promise<void> {
  for (const id of await hostnameIds(domain)) {
    await cf(`/custom_hostnames/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
