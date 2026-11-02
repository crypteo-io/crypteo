import type { HttpsProxyAgent } from "https-proxy-agent";
import {
  getProxyAgent,
  getRandomProxy,
  reportProxyFailure,
  reportProxySuccess,
} from "../proxy-rotation";

export interface RpcAttempt {
  url: string;
  agent: HttpsProxyAgent<string> | null;
}

export class AllEndpointsFailedError extends Error {
  readonly causes: { url: string; message: string }[];

  constructor(label: string, causes: { url: string; message: string }[]) {
    const detail = causes.map((c) => `${c.url}: ${c.message}`).join(" | ");
    super(`All endpoints failed for ${label}${detail ? `: ${detail}` : ""}`);
    this.name = "AllEndpointsFailedError";
    this.causes = causes;
  }
}

// Built-in endpoint lists by env var, so diagnostics (scripts/verify-rpc.ts)
// probe exactly what an adapter would fall back to instead of a copy.
const builtInDefaults = new Map<string, readonly string[]>();

/** Declare an adapter's built-in endpoints for `envVar`. Returns them. */
export function defineEndpoints(
  envVar: string,
  defaults: readonly string[],
): readonly string[] {
  builtInDefaults.set(envVar, defaults);
  return defaults;
}

/** The built-in endpoints declared for `envVar` (empty until its adapter loads). */
export function builtInEndpoints(envVar: string): string[] {
  return [...(builtInDefaults.get(envVar) ?? [])];
}

/** Endpoints from `envVar` (comma-separated), else `defaults`. Read per call. */
export function resolveEndpoints(
  envVar: string,
  defaults: readonly string[],
): string[] {
  const configured = (process.env[envVar] || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [...defaults];
}

/**
 * An endpoint declining to serve a method, as opposed to a transient fault.
 * Gated public nodes answer cheap methods and reject expensive ones, so they
 * pass every health check and must be skipped per-call instead.
 *
 * Matches phrases, not bare status numbers: "timeout of 6000ms exceeded" is a
 * proxy failure and must stay one.
 */
export function isEndpointRefusal(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return [
    "personal token",
    "indexed requests",
    "archive requests",
    "api key",
    "apikey",
    "method not found",
    "method not supported",
    "method not available",
    "unsupported method",
    "is not available",
    "-32601",
    "unauthorized",
    "forbidden",
    "payment required",
    "too many requests",
    "rate limit",
    "quota exceeded",
    "limit exceeded",
    "compute units",
  ].some((p) => msg.includes(p));
}

/**
 * Per-endpoint health, so rotation can skip what is currently unusable.
 *
 * Two kinds of unusable, deliberately tracked apart:
 *
 * `refusedMethods` — the endpoint serves some methods and declines others.
 * Keyed by method, and long-lived, because it is a property of the plan you are
 * on rather than a fault. publicnode answers getBalance forever while refusing
 * getTokenAccountsByOwner; forgetting that would send every SPL read back to it
 * and pay the round trip to be told no again.
 *
 * `cooldownUntil` — the whole endpoint is failing or rate-limiting. Short, since
 * it is expected to pass.
 */
interface EndpointHealth {
  failures: number;
  cooldownUntil: number;
  refusedMethods: Map<string, number>;
}

const REFUSAL_TTL_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const FAILURES_BEFORE_COOLDOWN = 3;

const health = new Map<string, EndpointHealth>();
// Rotation cursor per endpoint list, so consecutive calls spread across
// providers instead of concentrating on one and exhausting its free quota.
const cursor = new Map<string, number>();

function healthOf(url: string): EndpointHealth {
  let h = health.get(url);
  if (!h) {
    h = { failures: 0, cooldownUntil: 0, refusedMethods: new Map() };
    health.set(url, h);
  }
  return h;
}

function isUsable(url: string, method: string, now: number): boolean {
  const h = health.get(url);
  if (!h) return true;
  if (h.cooldownUntil > now) return false;
  const refusedAt = h.refusedMethods.get(method);
  return !(refusedAt !== undefined && now - refusedAt < REFUSAL_TTL_MS);
}

/** Reset all endpoint rotation and health state. Test seam. */
export function resetEndpointPreferences() {
  health.clear();
  cursor.clear();
}

/** Endpoint health, for diagnostics. */
export function endpointHealthSnapshot(): Record<
  string,
  { cooledDown: boolean; refusedMethods: string[] }
> {
  const now = Date.now();
  const out: Record<string, { cooledDown: boolean; refusedMethods: string[] }> =
    {};
  for (const [url, h] of health) {
    out[url] = {
      cooledDown: h.cooldownUntil > now,
      refusedMethods: [...h.refusedMethods]
        .filter(([, at]) => now - at < REFUSAL_TTL_MS)
        .map(([m]) => m),
    };
  }
  return out;
}

/**
 * Endpoints to try, in order: usable ones first, rotated so load spreads across
 * providers; then the rest as a last resort, because a stale cooldown is no
 * reason to fail a payment when nothing else is left.
 */
function orderEndpoints(
  key: string,
  endpoints: readonly string[],
  method: string,
): string[] {
  const now = Date.now();
  const start = cursor.get(key) ?? 0;
  const rotated = endpoints.map(
    (_, i) => endpoints[(start + i) % endpoints.length],
  );
  cursor.set(key, (start + 1) % endpoints.length);

  const usable = rotated.filter((u) => isUsable(u, method, now));
  const rest = rotated.filter((u) => !isUsable(u, method, now));
  return [...usable, ...rest];
}

export async function withEndpointFailover<T>(
  key: string,
  endpoints: readonly string[],
  label: string,
  fn: (attempt: RpcAttempt) => Promise<T>,
  opts: { isFatal?: (err: unknown) => boolean } = {},
): Promise<T> {
  if (endpoints.length === 0) {
    throw new AllEndpointsFailedError(label, [
      { url: "(none)", message: "no endpoints configured" },
    ]);
  }

  const causes: { url: string; message: string }[] = [];

  for (const url of orderEndpoints(key, endpoints, label)) {
    const h = healthOf(url);
    // A fault through a proxy is retried direct, so a dead proxy in the pool
    // never fails a read (2026-10-18: one unreachable proxy failed tron, bsc
    // and ada reads for hours). Only a direct fault is charged to the endpoint.
    const proxyUrl = getRandomProxy();
    for (const via of proxyUrl ? [proxyUrl, null] : [null]) {
      try {
        const value = await fn({ url, agent: via ? getProxyAgent(via) : null });
        reportProxySuccess(via);
        h.failures = 0;
        h.cooldownUntil = 0;
        h.refusedMethods.delete(label);
        return value;
      } catch (err) {
        if (opts.isFatal?.(err)) {
          reportProxySuccess(via);
          throw err;
        }

        const message = err instanceof Error ? err.message : String(err);
        causes.push({ url: via ? url : `${url} (direct)`, message });
        console.warn(`[rpc] ${label} failed on ${url} (proxy: ${via}): ${message}`);

        if (isEndpointRefusal(err)) {
          // The endpoint's answer about this method, not a fault. Remember it
          // so rotation stops asking, but keep using the endpoint for what it
          // does serve, and do not charge the proxy that delivered the answer.
          h.refusedMethods.set(label, Date.now());
          break;
        }
        if (via) {
          reportProxyFailure(via);
          continue;
        }
        h.failures++;
        if (h.failures >= FAILURES_BEFORE_COOLDOWN) {
          h.cooldownUntil = Date.now() + COOLDOWN_MS;
          h.failures = 0;
        }
      }
    }
  }

  throw new AllEndpointsFailedError(label, causes);
}
