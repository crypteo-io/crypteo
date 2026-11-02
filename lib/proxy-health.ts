import axios, { type AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { sendAdminAlert } from "./admin-alerts";
import { adminUrl } from "./admin-host";
import { prisma } from "./db";
import { proxyHealthHtml } from "./emails/templates";
import { notifyAdmins } from "./notifications";
import { maskProxyUrl } from "./proxy-rotation";
import { listProxies, PROXY_FAILING_AFTER, type StoredProxy } from "./proxy-settings";
import { SITE_NAME } from "./seo";

// The proxy health scan behind admin Proxies: real requests through each
// stored proxy (paused ones too, so an admin can see one recover), by the
// worker every PROXY_CHECK_CRON and on demand from the page.
//
// No false alarms: every scan first makes the same requests direct. A target
// that fails direct (it is down, or this server's network is) is left out of
// the scan, and with none left the scan records nothing. A proxy is flagged
// only after PROXY_FAILING_AFTER failed scans in a row.
// No missed failures: each proxy is tried against both kinds of request it
// carries, a price lookup and a chain RPC call, and passes only if all work.
// Alerts go out once per change: results are written compare-and-set, so a
// scan racing another (worker and "Check now") can't announce the same change.
// No spam: one email and one in-app notification per scan however many
// proxies changed, and per proxy a failing alert opens only when none is open
// and none went out in the last PROXY_ALERT_COOLDOWN_MS; a recovered alert
// only closes one that was sent. A flapping proxy stays flagged on the page.

export const PROXY_CHECK_TIMEOUT_MS = 10_000;
export const PROXY_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MIN_SCRUBBED_SECRET = 6;

export interface ProxyCheckTarget {
  name: string;
  request: AxiosRequestConfig;
  /** Whether the answer is the real thing, not an error page served with 200. */
  accept: (status: number, data: unknown) => boolean;
}

const is2xx = (status: number) => status >= 200 && status < 300;
const hasField = (data: unknown, field: string) => typeof data === "object" && data !== null && field in data;

export const PROXY_CHECK_TARGETS: ProxyCheckTarget[] = [
  {
    name: "Price lookup (Coinbase)",
    request: { method: "GET", url: "https://api.coinbase.com/v2/prices/BTC-USD/spot" },
    accept: (status, data) => is2xx(status) && hasField(data, "data"),
  },
  {
    name: "Chain RPC (Ethereum)",
    request: {
      method: "POST",
      url: "https://ethereum.publicnode.com",
      data: { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    },
    accept: (status, data) => is2xx(status) && hasField(data, "result"),
  },
];

export interface ProxyCheck {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

/**
 * An error's message without the proxy's credentials or full address: it is
 * stored, shown and emailed, and connection errors can echo what they were given.
 */
export function scrubProxyError(message: string, url: string): string {
  const secrets = [url];
  try {
    const { username, password } = new URL(url);
    const pairs = [[username, password], [decodeURIComponent(username), decodeURIComponent(password)]];
    for (const [user, pass] of pairs) if (user || pass) secrets.push(`${user}:${pass}@`, `${user}:${pass}`);
    // A bare password only when it's long enough not to match ordinary text:
    // replacing a one-letter password garbled every word containing it.
    for (const pass of [password, decodeURIComponent(password)]) if (pass.length >= MIN_SCRUBBED_SECRET) secrets.push(pass);
  } catch {
    // Not a URL: the input itself is all there is to strip.
  }
  let text = message;
  for (const secret of secrets.sort((a, b) => b.length - a.length)) text = text.split(secret).join("***");
  return text.slice(0, 200);
}

/** One target, through `proxyUrl` or direct (null). */
async function probe(target: ProxyCheckTarget, proxyUrl: string | null): Promise<ProxyCheck> {
  const started = Date.now();
  try {
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
    const res = await axios.request({
      ...target.request,
      httpsAgent: agent,
      httpAgent: agent,
      proxy: false,
      timeout: PROXY_CHECK_TIMEOUT_MS,
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - started;
    if (target.accept(res.status, res.data)) return { ok: true, latencyMs, error: null };
    return { ok: false, latencyMs, error: `${target.name}: HTTP ${res.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const text = `${target.name}: ${message || "request failed"}`;
    return { ok: false, latencyMs: null, error: proxyUrl ? scrubProxyError(text, proxyUrl) : text };
  }
}

/** The targets this server can reach direct right now: the only fair test of a proxy. */
export async function reachableTargets(targets = PROXY_CHECK_TARGETS): Promise<ProxyCheckTarget[]> {
  const direct = await Promise.all(targets.map((t) => probe(t, null)));
  return targets.filter((_, i) => direct[i].ok);
}

/** Every target through the proxy; it passes only if all of them answer. */
export async function checkProxy(url: string, targets: ProxyCheckTarget[]): Promise<ProxyCheck> {
  const results = await Promise.all(targets.map((t) => probe(t, url)));
  const failed = results.find((r) => !r.ok);
  if (failed) return failed;
  const latencies = results.flatMap((r) => (r.latencyMs === null ? [] : [r.latencyMs]));
  return { ok: true, latencyMs: Math.max(...latencies), error: null };
}

export type ProxyTransition = "failing" | "recovered" | null;

/** What this result changes: the scan that tips a proxy into failing, or out of it. */
export function transition(previousFailures: number, check: ProxyCheck): ProxyTransition {
  if (!check.ok) return previousFailures + 1 === PROXY_FAILING_AFTER ? "failing" : null;
  return previousFailures >= PROXY_FAILING_AFTER ? "recovered" : null;
}

/** Whether a change is announced: the hysteresis that keeps a flapping proxy quiet. */
export function shouldAlert(
  change: ProxyTransition,
  proxy: Pick<StoredProxy, "alertOpen" | "lastAlertAt">,
  at: Date,
): boolean {
  if (change === "recovered") return proxy.alertOpen;
  if (change === "failing") {
    return !proxy.alertOpen && (!proxy.lastAlertAt || at.getTime() - proxy.lastAlertAt.getTime() >= PROXY_ALERT_COOLDOWN_MS);
  }
  return false;
}

/**
 * Writes the result, and the alert it opens or closes, only if no other scan
 * wrote one since `proxy` was read: so a change is announced at most once.
 */
async function record(proxy: StoredProxy, check: ProxyCheck, at: Date, alert: ProxyTransition): Promise<boolean> {
  const { count } = await prisma.outboundProxy.updateMany({
    where: { id: proxy.id, consecutiveFailures: proxy.consecutiveFailures, lastCheckedAt: proxy.lastCheckedAt },
    data: {
      lastCheckedAt: at,
      lastLatencyMs: check.latencyMs,
      lastError: check.error,
      ...(check.ok ? { lastOkAt: at, consecutiveFailures: 0 } : { consecutiveFailures: proxy.consecutiveFailures + 1 }),
      ...(alert === "failing" ? { alertOpen: true, lastAlertAt: at } : {}),
      ...(alert === "recovered" ? { alertOpen: false } : {}),
    },
  });
  return count === 1;
}

export interface ProxyAlertEntry {
  name: string;
  isActive: boolean;
  error: string | null;
  lastOkAt: string | null;
}

const proxyName = (p: StoredProxy & { url: string }) =>
  p.label ? `${p.label} (${maskProxyUrl(p.url)})` : maskProxyUrl(p.url);

/** One email and one in-app notification per kind of change in a scan. */
async function announce(state: "failing" | "recovered", entries: ProxyAlertEntry[], at: Date): Promise<void> {
  if (entries.length === 0) return;
  const one = entries.length === 1;
  const names = entries.map((e) => e.name).join(", ");
  const title =
    state === "failing"
      ? one ? "A proxy is failing" : `${entries.length} proxies are failing`
      : one ? "A proxy recovered" : `${entries.length} proxies recovered`;
  await notifyAdmins({
    kind: state === "failing" ? "admin_proxy_failing" : "admin_proxy_recovered",
    title,
    body:
      state === "failing"
        ? `${names} failed ${PROXY_FAILING_AFTER} health checks in a row. Reads through ${one ? "it" : "them"} fall back to direct connections.`
        : `${names} passed ${one ? "its" : "their"} health check again.`,
    link: "/proxies",
  });
  const sent = await sendAdminAlert(
    `${state === "failing" ? "⛔" : "✅"} ${SITE_NAME}: ${title.toLowerCase()}`,
    proxyHealthHtml({ state, proxies: entries, failingAfter: PROXY_FAILING_AFTER, timestamp: at.toISOString(), pageUrl: adminUrl("/proxies") }),
  );
  if (!sent) console.error(`[proxies] ${state} alert email not sent (no ADMIN_EMAILS, or the mail failed)`);
}

export interface ProxyScan {
  /** True when no target was reachable direct, so nothing was recorded. */
  inconclusive: boolean;
  checked: number;
  failing: string[];
  recovered: string[];
}

/** Checks every readable stored proxy, records each result and announces changes. */
export async function checkAllProxies(now: () => Date = () => new Date()): Promise<ProxyScan> {
  const proxies = (await listProxies()).filter((p): p is StoredProxy & { url: string } => p.url !== null);
  if (proxies.length === 0) return { inconclusive: false, checked: 0, failing: [], recovered: [] };

  const targets = await reachableTargets();
  if (targets.length === 0) {
    console.warn("[proxies] health scan skipped: no test target is reachable direct, so a failure would say nothing about the proxies");
    return { inconclusive: true, checked: 0, failing: [], recovered: [] };
  }

  const changes = { failing: [] as ProxyAlertEntry[], recovered: [] as ProxyAlertEntry[] };
  await Promise.all(
    proxies.map(async (p) => {
      const check = await checkProxy(p.url, targets);
      const at = now();
      const change = transition(p.consecutiveFailures, check);
      const alert = shouldAlert(change, p, at) ? change : null;
      try {
        if (!(await record(p, check, at, alert))) return;
      } catch (error) {
        console.error("[proxies] health result not saved:", error);
        return;
      }
      if (alert) {
        changes[alert].push({
          name: proxyName(p),
          isActive: p.isActive,
          error: check.error,
          lastOkAt: (check.ok ? at : p.lastOkAt)?.toISOString() ?? null,
        });
      }
    }),
  );
  const at = now();
  await announce("failing", changes.failing, at);
  await announce("recovered", changes.recovered, at);
  return {
    inconclusive: false,
    checked: proxies.length,
    failing: changes.failing.map((e) => e.name),
    recovered: changes.recovered.map((e) => e.name),
  };
}
