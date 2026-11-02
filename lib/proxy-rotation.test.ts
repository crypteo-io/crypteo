import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maskProxyUrl, proxyManager } from "./proxy-rotation";

const PROXIES = ["http://a:1", "http://b:1", "http://c:1"];

function reset(list: string[] = PROXIES) {
  // Wipe all existing state, then load a fresh set with zeroed counters.
  proxyManager.setProxies([]);
  proxyManager.setProxies(list);
}

describe("ProxyManager", () => {
  beforeEach(() => reset());
  afterEach(() => vi.useRealTimers());

  it("loads all configured proxies", () => {
    const stats = proxyManager.getStats();
    expect(stats.total).toBe(3);
    expect(stats.available).toBe(3);
    expect(stats.sidelined).toBe(0);
  });

  it("returns one of the configured proxies", () => {
    expect(PROXIES).toContain(proxyManager.getProxy());
  });

  it("returns null when no proxies are configured", () => {
    reset([]);
    expect(proxyManager.getProxy()).toBeNull();
  });

  it("sidelines a proxy after 3 consecutive failures", () => {
    for (let i = 0; i < 3; i++) proxyManager.reportFailure("http://a:1");

    const stats = proxyManager.getStats();
    expect(stats.sidelined).toBe(1);
    expect(stats.available).toBe(2);

    // A sidelined proxy is never handed out.
    for (let i = 0; i < 20; i++) {
      expect(proxyManager.getProxy()).not.toBe("http://a:1");
    }
  });

  it("resets the failure count on success", () => {
    proxyManager.reportFailure("http://a:1");
    proxyManager.reportFailure("http://a:1");
    proxyManager.reportSuccess("http://a:1"); // back to 0
    proxyManager.reportFailure("http://a:1");
    proxyManager.reportFailure("http://a:1");

    // Only 2 failures since the reset — still below the sideline threshold.
    expect(proxyManager.getStats().sidelined).toBe(0);
  });

  it("recovers a sidelined proxy after the cool-off window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    for (let i = 0; i < 3; i++) proxyManager.reportFailure("http://a:1");
    expect(proxyManager.getStats().sidelined).toBe(1);

    // Advance past the 5-minute sideline duration.
    vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
    proxyManager.getProxy(); // triggers recovery sweep

    expect(proxyManager.getStats().sidelined).toBe(0);
  });

  it("puts a recovered proxy on probation behind healthy ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    for (let i = 0; i < 3; i++) proxyManager.reportFailure("http://a:1");

    vi.setSystemTime(new Date("2026-01-01T00:06:00.000Z"));
    for (let i = 0; i < 20; i++) {
      expect(proxyManager.getProxy()).not.toBe("http://a:1");
    }

    // One more failure sidelines it again, now for twice as long.
    proxyManager.reportFailure("http://a:1");
    expect(proxyManager.getStats().sidelined).toBe(1);
    vi.setSystemTime(new Date("2026-01-01T00:12:00.000Z"));
    proxyManager.getProxy();
    expect(proxyManager.getStats().sidelined).toBe(1);
    vi.setSystemTime(new Date("2026-01-01T00:17:00.000Z"));
    proxyManager.getProxy();
    expect(proxyManager.getStats().sidelined).toBe(0);
  });
});

describe("maskProxyUrl", () => {
  it("keeps the host and drops the credentials", () => {
    expect(maskProxyUrl("http://user:secret@proxy.example:8080")).toBe("http://proxy.example:8080");
    expect(maskProxyUrl("not a url")).toBe("(invalid proxy URL)");
  });
});
