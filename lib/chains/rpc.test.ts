import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as proxies from "../proxy-rotation";
import { proxyManager } from "../proxy-rotation";
import {
  AllEndpointsFailedError,
  endpointHealthSnapshot,
  isEndpointRefusal,
  resetEndpointPreferences,
  resolveEndpoints,
  withEndpointFailover,
  type RpcAttempt,
} from "./rpc";

const DEFAULTS = ["https://a.example", "https://b.example"] as const;

beforeEach(() => {
  resetEndpointPreferences();
  delete process.env.TEST_RPC_URLS;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEndpoints", () => {
  it("falls back to the built-in defaults when unset", () => {
    expect(resolveEndpoints("TEST_RPC_URLS", DEFAULTS)).toEqual([...DEFAULTS]);
  });

  it("lets the environment replace the list entirely", () => {
    process.env.TEST_RPC_URLS = "https://keyed.example/x";
    expect(resolveEndpoints("TEST_RPC_URLS", DEFAULTS)).toEqual([
      "https://keyed.example/x",
    ]);
  });

  it("trims and drops empty entries so a trailing comma is harmless", () => {
    process.env.TEST_RPC_URLS = " https://one.example , , https://two.example ,";
    expect(resolveEndpoints("TEST_RPC_URLS", DEFAULTS)).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });

  it("reads the environment at call time, not at import time", () => {
    expect(resolveEndpoints("TEST_RPC_URLS", DEFAULTS)).toEqual([...DEFAULTS]);
    process.env.TEST_RPC_URLS = "https://late.example";
    expect(resolveEndpoints("TEST_RPC_URLS", DEFAULTS)).toEqual([
      "https://late.example",
    ]);
  });
});

describe("isEndpointRefusal", () => {
  // The exact strings that took production down.
  it.each([
    'Indexed requests require a personal token. Get one at: https://www.allnodes.com/publicnode',
    "Archive requests require a personal token.",
    "eth_getLogs is limited — Unauthorized: You must authenticate your request with an API key",
    "server response 403 Forbidden",
    "429 Too Many Requests",
    "the method eth_getLogs does not exist/is not available: method not found",
  ])("recognises %s", (msg) => {
    expect(isEndpointRefusal(new Error(msg))).toBe(true);
  });

  it("does not mistake a real chain answer for a refusal", () => {
    expect(
      isEndpointRefusal(new Error("Invalid param: could not find account")),
    ).toBe(false);
    expect(isEndpointRefusal(new Error("connect ETIMEDOUT"))).toBe(false);
  });
});

describe("withEndpointFailover", () => {
  it("returns the first endpoint's answer without touching the rest", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      withEndpointFailover("k", DEFAULTS, "probe", fn),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("routes around an endpoint that refuses the method", async () => {
    // The production bug in miniature.
    const fn = vi.fn(async ({ url }: { url: string }) => {
      if (url === "https://a.example") {
        throw new Error("Indexed requests require a personal token");
      }
      return 10;
    });
    await expect(
      withEndpointFailover("k", DEFAULTS, "balance", fn),
    ).resolves.toBe(10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws with every endpoint's cause when none answer", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom-a"))
      .mockRejectedValueOnce(new Error("boom-b"));

    let err: unknown;
    try {
      await withEndpointFailover("k", DEFAULTS, "balance", fn);
    } catch (e) {
      err = e;
    }

    // Throws rather than returning a zero or null.
    expect(err).toBeInstanceOf(AllEndpointsFailedError);
    const failure = err as AllEndpointsFailedError;
    expect(failure.causes).toHaveLength(2);
    expect(failure.message).toContain("boom-a");
    expect(failure.message).toContain("boom-b");
  });

  it("surfaces a fatal error immediately without trying other endpoints", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("account not found"));
    await expect(
      withEndpointFailover("k", DEFAULTS, "balance", fn, {
        isFatal: (e) => String(e).includes("account not found"),
      }),
    ).rejects.toThrow("account not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rotates across endpoints so no single free quota carries the load", async () => {
    const seen: string[] = [];
    const fn = vi.fn(async ({ url }: { url: string }) => {
      seen.push(url);
      return 1;
    });

    await withEndpointFailover("rot", DEFAULTS, "probe", fn);
    await withEndpointFailover("rot", DEFAULTS, "probe", fn);
    await withEndpointFailover("rot", DEFAULTS, "probe", fn);

    // Alternating, not pinned to whichever answered first.
    expect(seen).toEqual([
      "https://a.example",
      "https://b.example",
      "https://a.example",
    ]);
  });

  it("stops sending a method to an endpoint that refused it, but keeps using it for others", async () => {
    const calls: string[] = [];
    const fn = vi.fn(async ({ url }: { url: string }, method: string) => {
      calls.push(`${method}@${url}`);
      if (url === "https://a.example" && method === "indexed") {
        throw new Error("Indexed requests require a personal token");
      }
      return 1;
    });

    // A refuses "indexed" once and is remembered.
    await withEndpointFailover("cap", DEFAULTS, "indexed", (a) =>
      fn(a, "indexed"),
    );
    calls.length = 0;

    await withEndpointFailover("cap", DEFAULTS, "indexed", (a) =>
      fn(a, "indexed"),
    );
    // A is skipped for "indexed" — no wasted round trip to be told no again.
    expect(calls).toEqual(["indexed@https://b.example"]);

    calls.length = 0;
    await withEndpointFailover("cap", DEFAULTS, "cheap", (a) => fn(a, "cheap"));
    // ...but A is still perfectly good for a method it does serve.
    expect(calls.some((c) => c.includes("https://a.example"))).toBe(true);
  });

  it("falls back to a refusing endpoint rather than failing when nothing else is left", async () => {
    const single = ["https://only.example"];
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("429 Too Many Requests");
      return "recovered";
    });

    await withEndpointFailover("last", single, "m", fn).catch(() => {});
    // Second call must still try it: a remembered refusal is no reason to fail
    // a payment when there is no alternative.
    await expect(
      withEndpointFailover("last", single, "m", fn),
    ).resolves.toBe("recovered");
  });

  it("fails loudly when no endpoints are configured at all", async () => {
    await expect(
      withEndpointFailover("k", [], "balance", vi.fn()),
    ).rejects.toBeInstanceOf(AllEndpointsFailedError);
  });
});

describe("withEndpointFailover through a proxy", () => {
  beforeEach(() => proxyManager.setProxies(["http://dead.proxy:8005"]));
  afterEach(() => proxyManager.setProxies([]));

  it("retries the endpoint direct when the proxy fails, and blames only the proxy", async () => {
    // The 2026-10-18 outage: every attempt went through an unreachable proxy.
    const failure = vi.spyOn(proxies, "reportProxyFailure");
    const fn = vi.fn(async ({ agent }: RpcAttempt) => {
      if (agent) throw new Error("connect ETIMEDOUT 83.218.213.152:8005");
      return 7;
    });

    await expect(
      withEndpointFailover("k", DEFAULTS, "balance", fn),
    ).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls.map(([a]) => a.url)).toEqual([
      "https://a.example",
      "https://a.example",
    ]);
    expect(failure).toHaveBeenCalledWith("http://dead.proxy:8005");
    expect(endpointHealthSnapshot()["https://a.example"].cooledDown).toBe(false);
  });

  it("takes a refusal through a proxy as the endpoint's answer, without a direct retry", async () => {
    const fn = vi.fn(async ({ url }: RpcAttempt) => {
      if (url === "https://a.example") {
        throw new Error("Indexed requests require a personal token");
      }
      return 10;
    });

    await expect(
      withEndpointFailover("k", DEFAULTS, "balance", fn),
    ).resolves.toBe(10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("reports both the proxied and the direct cause when an endpoint is down", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("down"));
    const err = await withEndpointFailover("k", DEFAULTS, "balance", fn).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AllEndpointsFailedError);
    if (!(err instanceof AllEndpointsFailedError)) return;
    expect(err.causes.map((c) => c.url)).toEqual([
      "https://a.example",
      "https://a.example (direct)",
      "https://b.example",
      "https://b.example (direct)",
    ]);
  });
});

describe("isEndpointRefusal precision", () => {
  it("counts a timeout as a proxy failure, not an endpoint refusal", () => {
    // A bare "exceeded" substring would excuse the proxy that timed out.
    expect(isEndpointRefusal(new Error("timeout of 6000ms exceeded"))).toBe(
      false,
    );
  });

  it("does not read a status-like number inside a hash as a refusal", () => {
    expect(
      isEndpointRefusal(new Error("tx 0x403429401abc reverted")),
    ).toBe(false);
  });

  it("still catches a real quota refusal", () => {
    expect(isEndpointRefusal(new Error("monthly quota exceeded"))).toBe(true);
    expect(isEndpointRefusal(new Error("server response 403 Forbidden"))).toBe(
      true,
    );
  });
});
