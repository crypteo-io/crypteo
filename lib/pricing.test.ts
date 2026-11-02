import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenPriceInUsd } from "./pricing";
import * as proxies from "./proxy-rotation";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(axios.get);

function serve(route: (url: string) => { status: number; data: unknown }) {
  get.mockImplementation(async (url: string) => route(url));
}

beforeEach(() => {
  get.mockReset();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("getTokenPriceInUsd", () => {
  it("prices stablecoins at 1 without a request", async () => {
    await expect(getTokenPriceInUsd("USDT")).resolves.toBe(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("uses Coinbase when it lists the pair", async () => {
    serve(() => ({ status: 200, data: { data: { amount: "0.25" } } }));
    await expect(getTokenPriceInUsd("ada")).resolves.toBe(0.25);
    expect(get.mock.calls[0][0]).toBe("https://api.coinbase.com/v2/prices/ADA-USD/spot");
  });

  it("falls back to CoinGecko at once when Coinbase doesn't list the pair, without blaming the proxy", async () => {
    const failure = vi.spyOn(proxies, "reportProxyFailure");
    serve((url) =>
      url.includes("coinbase")
        ? { status: 404, data: { errors: [{ id: "not_found" }] } }
        : { status: 200, data: { tron: { usd: 0.33 } } },
    );
    await expect(getTokenPriceInUsd("trx")).resolves.toBe(0.33);
    // One Coinbase call (a 404 is not retried), then CoinGecko.
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toContain("ids=tron");
    expect(failure).not.toHaveBeenCalled();
  });

  it("retries a transient Coinbase failure before falling back", async () => {
    serve((url) =>
      url.includes("coinbase")
        ? { status: 503, data: "" }
        : { status: 200, data: { "polygon-ecosystem-token": { usd: 0.1 } } },
    );
    await expect(getTokenPriceInUsd("pol")).resolves.toBe(0.1);
    expect(get.mock.calls.filter(([u]) => String(u).includes("coinbase"))).toHaveLength(2);
  });

  it("maps every new native token to a CoinGecko id", async () => {
    serve((url) =>
      url.includes("coinbase") ? { status: 404, data: {} } : { status: 200, data: {} },
    );
    for (const [token, id] of [
      ["bnb", "binancecoin"],
      ["pol", "polygon-ecosystem-token"],
      ["trx", "tron"],
      ["doge", "dogecoin"],
      ["zec", "zcash"],
      ["ada", "cardano"],
    ]) {
      get.mockClear();
      await expect(getTokenPriceInUsd(token)).rejects.toThrow();
      expect(get.mock.calls.some(([u]) => String(u).includes(`ids=${id}&`))).toBe(true);
    }
  });

  it("throws when no source can price the token", async () => {
    serve(() => ({ status: 503, data: "" }));
    await expect(getTokenPriceInUsd("doge")).rejects.toThrow();
  });

  it("rejects a zero or garbage price", async () => {
    serve((url) =>
      url.includes("coinbase")
        ? { status: 200, data: { data: { amount: "0" } } }
        : { status: 200, data: { zcash: { usd: "abc" } } },
    );
    await expect(getTokenPriceInUsd("zec")).rejects.toThrow();
  });

  it("treats a 403 (blocked proxy IP) as a fault to retry, not an unlisted pair", async () => {
    const failure = vi.spyOn(proxies, "reportProxyFailure");
    serve((url) =>
      url.includes("coinbase")
        ? { status: 403, data: "" }
        : { status: 200, data: { cardano: { usd: 0.25 } } },
    );
    await expect(getTokenPriceInUsd("ada")).resolves.toBe(0.25);
    expect(get.mock.calls.filter(([u]) => String(u).includes("coinbase"))).toHaveLength(2);
    expect(failure).toHaveBeenCalledTimes(2);
  });

  it("retries direct when the proxy fails", async () => {
    vi.spyOn(proxies, "getRandomProxy").mockReturnValue("http://dead.proxy:8005");
    get.mockImplementation(async (_url, config) => {
      if (config?.httpsAgent) throw new Error("connect ETIMEDOUT 83.218.213.152:8005");
      return { status: 200, data: { data: { amount: "0.25" } } };
    });
    await expect(getTokenPriceInUsd("ada")).resolves.toBe(0.25);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1]?.httpsAgent).toBeNull();
  });

  it("treats CoinGecko's 200 {} as unlisted, without charging the proxy or retrying", async () => {
    const failure = vi.spyOn(proxies, "reportProxyFailure");
    serve((url) =>
      url.includes("coinbase") ? { status: 404, data: {} } : { status: 200, data: {} },
    );
    await expect(getTokenPriceInUsd("trx")).rejects.toThrow(/no price/);
    expect(get).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
  });
});
