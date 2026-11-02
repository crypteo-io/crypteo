import dns from "dns/promises";
import { lookup as dnsLookupCb, type LookupAddress } from "dns";
import http from "http";
import https from "https";
import net from "net";

// ── SSRF protection for merchant-supplied webhook URLs ───────────────────────
//
// Webhook URLs are attacker-controllable (any registered merchant, or anyone
// with an API key). Without validation the server can be coerced into POSTing to
// internal services or the cloud metadata endpoint (169.254.169.254). We reject
// non-HTTP(S) URLs and any URL whose host is — or DNS-resolves to — a private,
// loopback, or link-local address.
//
// Validation alone is not enough: a hostname can resolve to a public address
// when checked and to 169.254.169.254 a moment later (DNS rebinding). Delivery
// therefore goes through postWebhook(), which re-checks every address at
// connect time, so what is validated is exactly what is connected to.

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b, c] = p;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved (incl. 255.255.255.255
  // broadcast) — nothing a merchant's webhook legitimately lives on.
  if (a >= 224) return true;
  return false;
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups, or null if malformed.
 * Parsing (rather than prefix-matching the string) matters because the WHATWG
 * URL parser re-serialises literals: `[::ffff:127.0.0.1]` reaches us as
 * `::ffff:7f00:1`, which a dotted-quad regex never sees.
 */
function parseIpv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);

  // A trailing dotted-quad occupies the last two groups.
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let tail: number[] = [];
  if (v4) {
    const o = v4[1].split(".").map(Number);
    if (o.some((n) => !Number.isInteger(n) || n > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    addr = addr.slice(0, -v4[1].length);
    if (addr.endsWith(":") && !addr.endsWith("::")) addr = addr.slice(0, -1);
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;

  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    return explicit === 8 ? [...head, ...tail] : null;
  }
  if (explicit > 7) return null;
  return [...head, ...new Array(8 - explicit).fill(0), ...rest, ...tail];
}

function v4From(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return true; // malformed → treat as unsafe

  const zeros = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);

  // :: (unspecified), ::1 (loopback), and IPv4-compatible ::a.b.c.d — all
  // fall in ::/96, whose embedded v4 is 0.x.x.x or the real target.
  if (zeros(0, 6)) {
    if (g[6] === 0 && g[7] <= 1) return true;
    return isPrivateIpv4(v4From(g[6], g[7]));
  }
  // IPv4-mapped ::ffff:a.b.c.d — the OS connects to the embedded v4.
  if (zeros(0, 5) && g[5] === 0xffff) return isPrivateIpv4(v4From(g[6], g[7]));
  // NAT64 well-known prefix 64:ff9b::/96 — a NAT64 gateway forwards to the
  // embedded v4, so 64:ff9b::a9fe:a9fe is the metadata endpoint.
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) {
    return isPrivateIpv4(v4From(g[6], g[7]));
  }
  // Local-use NAT64 64:ff9b:1::/48 is by definition site-internal.
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // 6to4 2002:AABB:CCDD::/48 tunnels to the v4 in groups 1–2.
  if (g[0] === 0x2002) return isPrivateIpv4(v4From(g[1], g[2]));
  // Teredo 2001:0::/32 embeds an obfuscated v4; no legitimate webhook uses it.
  if (g[0] === 0x2001 && g[1] === 0) return true;
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true; // not an IP → unsafe
}

/**
 * The host's own public addresses (WEBHOOK_BLOCKED_IPS, comma-separated). They
 * are "public" by every range check, yet a webhook aimed at them reaches
 * services on this machine — sshd, or anything else listening on 0.0.0.0. The
 * app can't discover them itself (the domain resolves to Cloudflare), so they
 * are configured. Read at call time, like the RPC endpoint lists.
 */
function configuredBlockedIps(): Set<string> {
  return new Set(
    (process.env.WEBHOOK_BLOCKED_IPS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True if a webhook must never connect to `ip`. */
export function isBlockedWebhookIp(ip: string): boolean {
  return isPrivateIp(ip) || configuredBlockedIps().has(ip.toLowerCase());
}

/**
 * True if `raw` is an http(s) URL whose host is public (safe to POST to).
 */
export async function isSafeWebhookUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(url.protocol)) return false;

  // URL keeps IPv6 literals bracketed ("[::1]"); net.isIP only recognises
  // the bare form, and without unwrapping they'd fall through to DNS.
  const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  if (net.isIP(host)) return !isBlockedWebhookIp(host);

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) return false;
    return records.every((r) => !isBlockedWebhookIp(r.address));
  } catch {
    return false;
  }
}

/**
 * dns.lookup replacement for outbound webhook sockets: resolves as usual, then
 * refuses the connection if ANY resolved address is blocked. Because the socket
 * connects to the address this returns, a rebinding DNS answer can't slip an
 * internal address past the earlier isSafeWebhookUrl() check.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number | undefined,
  callback: (...args: unknown[]) => void,
): void {
  const opts = typeof options === "object" && options ? options : {};
  dnsLookupCb(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlockedWebhookIp(a.address));
    if (list.length === 0 || bad) {
      const e = new Error(
        `Webhook host ${hostname} resolved to a blocked address`,
      ) as NodeJS.ErrnoException;
      e.code = "EWEBHOOKBLOCKED";
      return callback(e);
    }
    if (opts.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export interface WebhookHttpResponse {
  status: number;
  ok: boolean;
  location: string | null;
  text: string;
}

/**
 * POST `body` to a merchant webhook URL with SSRF protection enforced at the
 * socket, not just at validation time:
 *  - http(s) only; literal IPs checked directly (Node skips lookup for them);
 *  - hostnames resolved through guardedLookup, so every address is checked at
 *    connect time (closes DNS rebinding);
 *  - redirects are never followed (node:http doesn't) — the caller sees the
 *    3xx and its Location;
 *  - a hard timeout and a cap on how much of the response is read.
 * Throws on a blocked destination, network error or timeout.
 */
export function postWebhook(
  raw: string,
  {
    headers,
    body,
    timeoutMs,
    maxResponseBytes = 16 * 1024,
  }: {
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    maxResponseBytes?: number;
  },
): Promise<WebhookHttpResponse> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return reject(new Error("Invalid webhook URL"));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return reject(new Error("Webhook URL must be http(s)"));
    }
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    if (net.isIP(host) && isBlockedWebhookIp(host)) {
      return reject(new Error(`Webhook address ${host} is blocked`));
    }

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        lookup: guardedLookup as unknown as typeof dnsLookupCb,
        // A pooled socket could be reused for a different, unchecked host.
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size < maxResponseBytes) {
            chunks.push(chunk);
            size += chunk.length;
          }
          if (size >= maxResponseBytes) res.destroy();
        });
        const finish = () =>
          resolve({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            location:
              typeof res.headers.location === "string"
                ? res.headers.location
                : null,
            text: Buffer.concat(chunks).toString("utf8").slice(0, maxResponseBytes),
          });
        res.on("end", finish);
        res.on("close", finish); // also covers our own destroy() at the cap
        res.on("error", finish);
      },
    );
    // Wall-clock bound for the whole exchange, not just socket idleness.
    const timer = setTimeout(
      () => req.destroy(new Error(`Webhook timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    req.on("timeout", () =>
      req.destroy(new Error(`Webhook timed out after ${timeoutMs}ms`)),
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on("close", () => clearTimeout(timer));
    req.end(body);
  });
}

// ── Bot / crawler detection ──────────────────────────────────────────────────
//
// The public /pay/[id] link creates a payment session on GET. Chat-app link
// unfurlers and crawlers hitting the shared URL would each mint a throwaway
// session. Detect the common ones so we can render a static preview instead.

const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|slackbot|twitterbot|discordbot|telegrambot|whatsapp|linkedinbot|embedly|quora link preview|pinterest|redditbot|preview|curl|wget|python-requests|axios|go-http-client|headless|lighthouse|bingpreview/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // no UA is almost always automated
  return BOT_UA.test(userAgent);
}
