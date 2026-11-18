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

/**
 * Wildcard DNS: any name under them resolves to the IP written in it, so
 * anyone points one at their own mail server in seconds
 * (x@shop.203.0.113.7.sslip.io, 2026-11-15).
 */
const WILDCARD_DNS = new Set(["sslip.io", "nip.io", "xip.io", "traefik.me", "lvh.me", "localtest.me", "vcap.me"]);
/** A domain that names itself a throwaway service, listed or not. */
const THROWAWAY_NAME = /temp-?mail|throw-?away|burner-?mail|disposable|trash-?mail|fake-?mail|\d+-?minute-?mail/;
/** An IPv4 address written into a host name, dotted or dashed. */
const IP_IN_HOST = /(^|[.-])\d{1,3}([.-]\d{1,3}){3}([.-]|$)/;

export type EmailVerdict = "ok" | "disposable" | "suspicious" | "undeliverable" | "malformed";

function listed(host: string): boolean {
  return listHasDomain(host) || EXTRA_DISPOSABLE.has(host) || WILDCARD_DNS.has(host);
}

export function isDisposableDomain(domain: string): boolean {
  const host = domain.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (listed(host) || IP_IN_HOST.test(host) || THROWAWAY_NAME.test(host)) return true;
  // Throwaway services routinely hand out subdomains of one parent.
  const labels = host.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    if (listed(labels.slice(i).join("."))) return true;
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

/** Mail servers and addresses looked up per sign-up: enough to see through one domain. */
const MAX_MX_HOSTS = 3;
const MAX_IPS_PER_HOST = 2;

export interface MailRoute {
  accepts: boolean;
  /** The MX hosts and the reverse-DNS names of their addresses. */
  serverNames: string[];
}

/**
 * Whether a domain takes mail, and the names of the servers that receive it.
 * Accepts on lookup failure: a resolver outage must not become a signup
 * outage.
 */
export async function mailRoute(domain: string): Promise<MailRoute> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  resolver.setServers(RESOLVERS);

  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.length > 0) {
      if (isNullMx(mx)) return { accepts: false, serverNames: [] };
      const hosts = [...mx].sort((a, b) => a.priority - b.priority).map((r) => r.exchange).slice(0, MAX_MX_HOSTS);
      return { accepts: true, serverNames: [...hosts, ...(await reverseNames(resolver, hosts))] };
    }
  } catch (error) {
    if (!isNoSuchRecord(error)) return { accepts: true, serverNames: [] };
  }

  try {
    return { accepts: (await resolver.resolve4(domain)).length > 0, serverNames: [] };
  } catch (error) {
    return { accepts: !isNoSuchRecord(error), serverNames: [] };
  }
}

/**
 * What the MX hosts' addresses call themselves. temp-mail.io gives each fresh
 * domain a mail server named after the domain itself (mail.tanpony.com), so
 * only the reverse DNS of its address (forward3.mail.temp-mail.io) gives it
 * away (2026-11-16). A failed lookup is just a missing name.
 */
async function reverseNames(resolver: Resolver, hosts: readonly string[]): Promise<string[]> {
  const ips = (
    await Promise.all(hosts.map((h) => resolver.resolve4(h).then((a) => a.slice(0, MAX_IPS_PER_HOST), () => [] as string[])))
  ).flat();
  const names = await Promise.all([...new Set(ips)].map((ip) => resolver.reverse(ip).catch(() => [] as string[])));
  return names.flat();
}

/**
 * Throwaway services put fresh domains on their own mail servers faster than
 * any list keeps up: fldubai.com (MX in.mail.tm) and mailerq.net (MX
 * mail.burnermail.io) were on no list on 2026-11-15; tanpony.com and
 * ooynib.com (MX mail.<domain> at forward3.mail.temp-mail.io) on 2026-11-16.
 * The mail server's name, or its address's, gives them away.
 */
export function mxIsDisposable(serverNames: readonly string[]): boolean {
  return serverNames.some((name) => isDisposableDomain(name));
}

export async function checkEmail(email: string): Promise<EmailVerdict> {
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1).toLowerCase() : "";
  if (!domain.includes(".")) return "malformed";
  if (isDisposableDomain(domain)) return "disposable";
  // Refused, not just flagged (user, 2026-11-16): flagged sign-ups kept
  // arriving from throwaway inboxes while each scored under the suspension
  // threshold.
  if (suspiciousEmailReason(email)) return "suspicious";
  const route = await mailRoute(domain);
  if (!route.accepts) return "undeliverable";
  if (mxIsDisposable(route.serverNames)) return "disposable";
  return "ok";
}

/** Words a prober puts in the address it signs up with. */
const PROBE_WORDS = /sqli|xss|pentest|probe|hack|exploit|payload|inject/;
/** Words of a throwaway or test address. */
const THROWAWAY_WORDS = /^(test|temp|tmp|fake|dummy|spam|junk|trash|burner)|(test|temp|fake|spam)\d*$/;
const KEYBOARD_ROWS = /qwert|asdfg|zxcvb|qazwsx|12345|09876/;
/**
 * TLDs where most domains are throwaway or abuse (cheap or free to register).
 * Flagged only: real businesses use some of them.
 */
const HIGH_RISK_TLDS = new Set(["tk", "ml", "ga", "cf", "gq", "xyz", "top", "icu", "buzz", "monster", "rest", "cam", "uno", "click", "loan", "work", "pw"]);

/**
 * Why an address looks machine-made, or null. Only flagged for admins, never
 * refused: real people have odd addresses too. Seen on 2026-11-15:
 * k3ttrw@, shopx78kkzq@ (digits between letters), tomtom418@ (a
 * repeated chunk), mysqli@ and sqli7@. The rest are the stronger rules of a
 * mailing-list cleaner (mail-list-filter); its looser ones (every character
 * unique, high entropy, short names, unknown providers) flag real merchants.
 */
export function suspiciousEmailReason(email: string): string | null {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at).toLowerCase().split("+")[0] ?? "";
  const bare = local.replace(/[._-]/g, "");
  const tld = email.slice(at + 1).toLowerCase().split(".").pop() ?? "";
  if (PROBE_WORDS.test(local)) return "The address names an attack technique.";
  if (THROWAWAY_WORDS.test(bare)) return "The address reads as a test or throwaway one.";
  if (/[a-z]\d+[a-z]/.test(bare)) return "Digits sit between letters, as in generated addresses.";
  if (/([a-z]{3,})\1/.test(local)) return "The address repeats a chunk of letters, as in generated addresses.";
  if (/^[a-f0-9]{10,}$/.test(bare) || /\d{6,}/.test(bare)) return "The address is a long run of digits or hex, as in generated addresses.";
  if (KEYBOARD_ROWS.test(bare)) return "The address is a row of keyboard keys.";
  if (/[bcdfghjklmnpqrstvwxz]{6,}/.test(bare)) return "Six or more consonants in a row, as in generated addresses.";
  if (HIGH_RISK_TLDS.has(tld)) return `.${tld} domains are mostly throwaway.`;
  return null;
}

/**
 * The inbox an address delivers to: Gmail ignores dots and everything after
 * "+", so one inbox can open many accounts.
 */
export function inboxKey(email: string): string {
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1).toLowerCase();
  const local = email.slice(0, at).toLowerCase().split("+")[0] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@gmail.com`;
  }
  return `${local}@${domain}`;
}

export function emailRejectionMessage(verdict: EmailVerdict): string | null {
  switch (verdict) {
    case "disposable":
      return "Please use a permanent email address. Temporary inboxes aren't accepted.";
    case "suspicious":
      // Says nothing about which rule matched: that would teach the workaround.
      return "We can't accept this email address. Please use the address you normally use for your business.";
    case "undeliverable":
      return "That domain can't receive email. Check the spelling.";
    case "malformed":
      return "Enter a valid email address.";
    default:
      return null;
  }
}
