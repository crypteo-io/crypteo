import { isDisposableDomain as listHasDomain } from "@visulima/disposable-email-domains";
import { Resolver } from "node:dns/promises";

// Signup email quality (ported from pressfeed's email-quality): the bundled
// ~141k-domain throwaway blocklist plus an MX/A deliverability check, which
// catches typos and invented domains. Throwaway signups probed the site on
// 2026-10-23.

const RESOLVERS = ["1.1.1.1", "8.8.8.8"];
const TIMEOUT_MS = 4_000;

/** Confirmed missing from the upstream list. */
const EXTRA_DISPOSABLE = new Set([
  "yopmail.com", "yopmail.fr", "yopmail.net", "yopmail.gg", "yopmail.pp.ua",
  "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc", "nomail.xl.cx",
  "mega.zik.dj", "speed.1s.fr", "courriel.fr.nf", "moncourrier.fr.nf",
  "monemail.fr.nf", "monmail.fr.nf",
  "temp-mail.org", "temp-mail.io", "temp-mail.ru", "tempmail.plus",
]);

export type EmailVerdict = "ok" | "disposable" | "undeliverable" | "malformed";

export function isDisposableDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (listHasDomain(host) || EXTRA_DISPOSABLE.has(host)) return true;
  // Throwaway services routinely hand out subdomains of one parent.
  const labels = host.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    const parent = labels.slice(i).join(".");
    if (listHasDomain(parent) || EXTRA_DISPOSABLE.has(parent)) return true;
  }
  return false;
}

export function isDisposableEmail(email: string): boolean {
  return isDisposableDomain(email.slice(email.lastIndexOf("@") + 1));
}

/**
 * The RFC 7505 null MX: a single record whose target is the root label,
 * "this domain never accepts mail". Node's resolver returns the root label as
 * an empty string, not ".", so a check for "." alone never fires (example.com
 * publishes one).
 */
export function isNullMx(records: { exchange: string }[]): boolean {
  if (records.length !== 1) return false;
  return (records[0]?.exchange ?? "").trim().replace(/\.$/, "") === "";
}

function isNoSuchRecord(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  return code === "ENOTFOUND" || code === "ENODATA";
}

/** True on lookup failure: a resolver outage must not become a signup outage. */
export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  resolver.setServers(RESOLVERS);

  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.length > 0) return !isNullMx(mx);
  } catch (error) {
    if (!isNoSuchRecord(error)) return true;
  }

  try {
    return (await resolver.resolve4(domain)).length > 0;
  } catch (error) {
    return !isNoSuchRecord(error);
  }
}

export async function checkEmail(email: string): Promise<EmailVerdict> {
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1).toLowerCase() : "";
  if (!domain.includes(".")) return "malformed";
  if (isDisposableDomain(domain)) return "disposable";
  if (!(await domainAcceptsMail(domain))) return "undeliverable";
  return "ok";
}

export function emailRejectionMessage(verdict: EmailVerdict): string | null {
  switch (verdict) {
    case "disposable":
      return "Please use a permanent email address. Temporary inboxes aren't accepted.";
    case "undeliverable":
      return "That domain can't receive email. Check the spelling.";
    case "malformed":
      return "Enter a valid email address.";
    default:
      return null;
  }
}
