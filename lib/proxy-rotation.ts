import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Proxy Manager for handling rotation and health tracking
 */
interface ProxyState {
  url: string;
  failCount: number;
  lastUsedAt: number;
  lastSuccessAt: number;
  isSidelined: boolean;
  sidelinedUntil: number;
  sidelines: number;
}

class ProxyManager {
  private proxies: Map<string, ProxyState> = new Map();
  private readonly MAX_FAILURES = 3;
  private readonly SIDELINE_DURATION = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_SIDELINE_DURATION = 60 * 60 * 1000;

  /**
   * Replaces the proxy list: admin Proxies, loaded by syncProxies
   * (lib/proxy-settings.ts). Proxies still listed keep their health state.
   */
  public setProxies(urls: string[]) {
    // Add new proxies, keep state for existing ones, remove old ones
    const currentUrls = new Set(urls);
    for (const url of Array.from(this.proxies.keys())) {
      if (!currentUrls.has(url)) {
        this.proxies.delete(url);
      }
    }

    for (const url of urls) {
      if (!this.proxies.has(url)) {
        this.proxies.set(url, {
          url,
          failCount: 0,
          lastUsedAt: 0,
          lastSuccessAt: 0,
          isSidelined: false,
          sidelinedUntil: 0,
          sidelines: 0,
        });
      }
    }
  }

  /**
   * Returns the best available proxy or null
   */
  public getProxy(): string | null {
    const now = Date.now();
    const available = Array.from(this.proxies.values()).filter((p) => {
      if (p.isSidelined && p.sidelinedUntil < now) {
        // Back on probation: sorted behind healthy proxies, and one more
        // failure sidelines it again. Resetting to 0 put a dead proxy at the
        // front of the queue every 5 minutes.
        p.isSidelined = false;
        p.failCount = this.MAX_FAILURES - 1;
      }
      return !p.isSidelined;
    });

    if (available.length === 0) return null;

    // Sorting strategy:
    // 1. Least failCount first
    // 2. Least recently used second (to ensure rotation)
    available.sort((a, b) => {
      if (a.failCount !== b.failCount) return a.failCount - b.failCount;
      return a.lastUsedAt - b.lastUsedAt;
    });

    // Pick from the top 3 of the least-failing proxies, so a failing one is
    // never picked while a clean one is available.
    const fewest = available[0].failCount;
    const candidates = available
      .filter((p) => p.failCount === fewest)
      .slice(0, 3);
    const selected = candidates[Math.floor(Math.random() * candidates.length)];

    selected.lastUsedAt = now;
    return selected.url;
  }

  public reportFailure(url: string) {
    const state = this.proxies.get(url);
    if (!state) return;

    state.failCount++;
    if (state.failCount >= this.MAX_FAILURES) {
      // Each consecutive sideline doubles, so a dead proxy stops being retried.
      const duration = Math.min(
        this.SIDELINE_DURATION * 2 ** state.sidelines,
        this.MAX_SIDELINE_DURATION,
      );
      state.sidelines++;
      state.isSidelined = true;
      state.sidelinedUntil = Date.now() + duration;
      console.warn(
        `[ProxyManager] Sidelining failing proxy: ${maskProxyUrl(url)} for ${duration / 60000} minutes.`,
      );
    }
  }

  public reportSuccess(url: string) {
    const state = this.proxies.get(url);
    if (!state) return;

    state.failCount = 0; // Reset on success
    state.sidelines = 0;
    state.lastSuccessAt = Date.now();
  }

  public getStats() {
    const all = Array.from(this.proxies.values());
    return {
      total: all.length,
      available: all.filter((p) => !p.isSidelined).length,
      sidelined: all.filter((p) => p.isSidelined).length,
    };
  }
}

// Singleton instance
export const proxyManager = new ProxyManager();

/** For logs and lists: scheme, host and port, never the credentials. */
export function maskProxyUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return "(invalid proxy URL)";
  }
}

/**
 * Migration helpers to keep compatibility with previous functions
 */
export function getRandomProxy(): string | null {
  return proxyManager.getProxy();
}

/**
 * Returns an HttpsProxyAgent for a given (or random) proxy url
 */
export function getProxyAgent(
  proxyUrl?: string | null,
): HttpsProxyAgent<string> | null {
  const url = proxyUrl || proxyManager.getProxy();
  if (!url) return null;
  try {
    return new HttpsProxyAgent(url);
  } catch (err) {
    console.error("Invalid proxy URL:", maskProxyUrl(url), err);
    return null;
  }
}

export function reportProxyFailure(url: string | null) {
  if (url) proxyManager.reportFailure(url);
}

export function reportProxySuccess(url: string | null) {
  if (url) proxyManager.reportSuccess(url);
}
