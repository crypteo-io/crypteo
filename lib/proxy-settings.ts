import crypto from "crypto";
import { prisma } from "./db";
import { maskProxyUrl, proxyManager } from "./proxy-rotation";

// Outbound proxies, managed on admin Proxies and stored in OutboundProxy.
// A proxy URL carries its credentials, so it is encrypted at rest; the app
// and the worker each load the active ones into their rotation
// (lib/proxy-rotation.ts) on start and every minute after.

export const PROXY_SYNC_INTERVAL_MS = 60_000;
export const MAX_PROXY_URL_LENGTH = 500;
export const MAX_PROXY_LABEL_LENGTH = 60;
/** Consecutive failed health checks (lib/proxy-health.ts) before a proxy is flagged. */
export const PROXY_FAILING_AFTER = 3;

const FORMAT = "p1";
const MIN_KEY_LENGTH = 32;

// The deployment's secret-encryption key (also behind authenticator secrets),
// derived separately for this purpose. Without it nothing can be stored or
// read: fails closed. Rotating it makes every stored proxy unreadable.
function encryptionKey(): Buffer | null {
  const raw = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  if (!raw || raw.length < MIN_KEY_LENGTH) return null;
  return Buffer.from(crypto.hkdfSync("sha256", raw, Buffer.alloc(0), "outbound-proxy-url", 32));
}

export function isProxyStorageAvailable(): boolean {
  return encryptionKey() !== null;
}

export function encryptProxyUrl(url: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("TWO_FACTOR_ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  return [FORMAT, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** The stored URL, or null when it can't be read (another key, or not ours). */
export function decryptProxyUrl(stored: string): string | null {
  const key = encryptionKey();
  const [format, iv, tag, data] = stored.split(":");
  if (!key || format !== FORMAT || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * A proxy URL as typed, or why it can't be used. http(s) only, since that is
 * what the rotation's HttpsProxyAgent speaks; a host is required; nothing
 * after the port, and no spaces or commas (the old env list was comma-split).
 */
export function parseProxyUrl(input: string): { url: string } | { error: string } {
  const url = input.trim();
  if (!url) return { error: "Enter a proxy URL." };
  if (url.length > MAX_PROXY_URL_LENGTH) return { error: `Keep it under ${MAX_PROXY_URL_LENGTH} characters.` };
  if (/[\s,]/.test(url)) return { error: "A proxy URL can't contain spaces or commas." };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "That isn't a URL. Use http://user:pass@host:port." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http:// and https:// proxies are supported." };
  }
  if (!parsed.hostname) return { error: "The URL needs a host." };
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    return { error: "Use just the proxy address: http://user:pass@host:port." };
  }
  return { url };
}

export interface StoredProxy {
  id: string;
  /** null when it can't be decrypted with the current key. */
  url: string | null;
  label: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastCheckedAt: Date | null;
  lastOkAt: Date | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  alertOpen: boolean;
  lastAlertAt: Date | null;
}

export async function listProxies(): Promise<StoredProxy[]> {
  const rows = await prisma.outboundProxy.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ ...r, url: decryptProxyUrl(r.url) }));
}

/** Whether `url` is already stored (under another id than `exceptId`). */
export function isDuplicateProxy(stored: StoredProxy[], url: string, exceptId?: string): boolean {
  return stored.some((p) => p.id !== exceptId && p.url === url);
}

/**
 * Loads the active proxies into this process's rotation. A failed read keeps
 * the current list: a database blip must not silently switch every chain read
 * to direct connections.
 */
export async function syncProxies(): Promise<void> {
  try {
    const active = (await listProxies()).filter((p) => p.isActive);
    const unreadable = active.filter((p) => p.url === null).length;
    if (unreadable) console.error(`[proxies] ${unreadable} stored proxy URL(s) can't be decrypted with the current key`);
    proxyManager.setProxies(active.flatMap((p) => (p.url ? [p.url] : [])));
  } catch (error) {
    console.error("[proxies] could not load proxies, keeping the current list:", error);
  }
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

/** Loads now, then every PROXY_SYNC_INTERVAL_MS. Safe to call more than once. */
export async function startProxySync(): Promise<void> {
  await syncProxies();
  if (syncTimer) return;
  syncTimer = setInterval(() => void syncProxies(), PROXY_SYNC_INTERVAL_MS);
  syncTimer.unref?.();
}

export interface ProxyInput {
  url?: string;
  label?: string | null;
  isActive?: boolean;
}

/**
 * An admin's create (all of url required) or update (any subset) request,
 * checked field by field so the form can show the error under its field.
 */
export function parseProxyInput(
  body: unknown,
  mode: "create" | "update",
): { data: ProxyInput } | { error: string; field?: string } {
  if (typeof body !== "object" || body === null) return { error: "Invalid request body" };
  const b: Record<string, unknown> = { ...body };
  const data: ProxyInput = {};

  if (b.url !== undefined || mode === "create") {
    if (typeof b.url !== "string") return { error: "Enter a proxy URL.", field: "url" };
    const parsed = parseProxyUrl(b.url);
    if ("error" in parsed) return { error: parsed.error, field: "url" };
    data.url = parsed.url;
  }
  if (b.label !== undefined) {
    if (b.label !== null && typeof b.label !== "string") return { error: "Invalid label", field: "label" };
    const label = typeof b.label === "string" ? b.label.trim() : "";
    if (label.length > MAX_PROXY_LABEL_LENGTH) {
      return { error: `Keep the label under ${MAX_PROXY_LABEL_LENGTH} characters.`, field: "label" };
    }
    data.label = label || null;
  }
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== "boolean") return { error: "Invalid status", field: "isActive" };
    data.isActive = b.isActive;
  }
  if (mode === "update" && Object.keys(data).length === 0) return { error: "Nothing to change" };
  return { data };
}

/** What the admin API returns for a proxy. The URL goes only to admins. */
export function proxyView(p: StoredProxy) {
  return {
    id: p.id,
    url: p.url,
    host: p.url ? maskProxyUrl(p.url) : null,
    label: p.label,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    health: {
      checkedAt: p.lastCheckedAt?.toISOString() ?? null,
      okAt: p.lastOkAt?.toISOString() ?? null,
      latencyMs: p.lastLatencyMs,
      error: p.lastError,
      consecutiveFailures: p.consecutiveFailures,
      failing: p.consecutiveFailures >= PROXY_FAILING_AFTER,
    },
  };
}
export type ProxyView = ReturnType<typeof proxyView>;
