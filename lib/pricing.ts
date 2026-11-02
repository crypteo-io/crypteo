import axios from "axios";
import {
  getProxyAgent,
  getRandomProxy,
  reportProxyFailure,
  reportProxySuccess,
} from "./proxy-rotation";

// CoinGecko ids for the fallback source. Coinbase doesn't list every coin we
// accept (and has delisted pairs before), so each token needs a second source.
const COINGECKO_IDS: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  xrp: "ripple",
  bnb: "binancecoin",
  pol: "polygon-ecosystem-token",
  trx: "tron",
  doge: "dogecoin",
  zec: "zcash",
  ada: "cardano",
};

/** The source answered, and the answer is "no such pair" — don't retry it. */
class UnlistedError extends Error {}

interface PriceSource {
  name: string;
  /** Null when the source has no market for this token at all. */
  url(token: string): string | null;
  /** NaN for a malformed answer; throws UnlistedError when the answer is "no such coin". */
  parse(data: unknown, token: string): number;
}

const SOURCES: PriceSource[] = [
  {
    name: "coinbase",
    url: (token) =>
      `https://api.coinbase.com/v2/prices/${token.toUpperCase()}-USD/spot`,
    parse: (data) =>
      parseFloat(
        (data as { data?: { amount?: string } } | null)?.data?.amount ?? "",
      ),
  },
  {
    name: "coingecko",
    url: (token) => {
      const id = COINGECKO_IDS[token];
      return id
        ? `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
        : null;
    },
    parse: (data, token) => {
      const id = COINGECKO_IDS[token];
      const body = data as Record<string, { usd?: number }> | null;
      // CoinGecko answers an unknown id with 200 {} — an answer, not a fault.
      if (body && typeof body === "object" && Object.keys(body).length === 0) {
        throw new UnlistedError(`coingecko has no price for ${id}`);
      }
      return Number(body?.[id]?.usd);
    },
  },
];

const ATTEMPTS_PER_SOURCE = 2;

export async function getTokenPriceInUsd(token: string): Promise<number> {
  const normalized = token.toLowerCase();
  if (normalized === "usdc" || normalized === "usdt") {
    return 1;
  }

  let lastError: unknown;

  for (const source of SOURCES) {
    const url = source.url(normalized);
    if (!url) continue;

    for (let i = 0; i < ATTEMPTS_PER_SOURCE; i++) {
      // The last attempt goes direct, so a dead proxy never fails a price.
      const proxyUrl = i < ATTEMPTS_PER_SOURCE - 1 ? getRandomProxy() : null;
      const agent = proxyUrl ? getProxyAgent(proxyUrl) : null;

      try {
        const res = await axios.get(url, {
          httpsAgent: agent,
          httpAgent: agent,
          proxy: false,
          timeout: 4000,
          validateStatus: () => true,
        });
        // 400/404 are the source's answer about the pair, delivered fine —
        // not the proxy's fault, and not retryable. 401/403/429 are about the
        // caller (often a blocked proxy IP), so they retry like any fault.
        if (res.status === 400 || res.status === 404) {
          reportProxySuccess(proxyUrl);
          throw new UnlistedError(
            `${source.name} has no ${normalized.toUpperCase()}-USD price (HTTP ${res.status})`,
          );
        }
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`${source.name} HTTP ${res.status}`);
        }

        let price: number;
        try {
          price = source.parse(res.data, normalized);
        } catch (err) {
          if (err instanceof UnlistedError) reportProxySuccess(proxyUrl);
          throw err;
        }
        if (!price || isNaN(price) || price <= 0) {
          throw new Error(
            `Invalid price returned from ${source.name} for ${normalized}`,
          );
        }

        reportProxySuccess(proxyUrl);
        return price;
      } catch (err: unknown) {
        lastError = err;
        console.warn(
          `[pricing] Failed to fetch ${normalized} from ${source.name} via ${proxyUrl}:`,
          err instanceof Error ? err.message : String(err),
        );
        if (err instanceof UnlistedError) break; // Next source.
        reportProxyFailure(proxyUrl);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  throw lastError || new Error(`All price sources failed for ${normalized}`);
}
