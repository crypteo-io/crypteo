import { getAdapter } from "./registry";

/**
 * Chain read-path readiness: calls getBalanceSnapshot for every chain/token
 * pair, the same path a poll takes. Liveness is not readiness — a cheap health
 * check passes on an endpoint that refuses the method the money path needs.
 */

// Values are irrelevant; what matters is that the call completes, which needs
// the same gated methods a real poll does. Permanent accounts, so a failure is
// never just "that address was reaped".
const PROBE_ADDRESSES: Record<string, string> = {
  // Permanent, non-zero, holds ERC-20s.
  eth: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  // Genesis coinbase output.
  btc: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
  // Always exists.
  sol: "So11111111111111111111111111111111111111112",
  // Ripple genesis account.
  xrp: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  // Binance's hot wallet: long-lived and holds the BEP-20/Polygon tokens.
  bsc: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
  polygon: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
  // A high-traffic exchange wallet: activated and permanent. Its USDT balance
  // may be 0 — the probe proves the read works, not that funds exist.
  tron: "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL",
  // The largest Dogecoin address; years of history.
  doge: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
  // A mining-pool payout address (coinbase output recipient).
  zec: "t1XQZdZMnzXBcL8yx2PR27dSNrqctgwLgux",
  // The CIP-19 example base address, which holds a balance on mainnet.
  ada: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
};

export interface PairReadiness {
  chain: string;
  token: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface ChainReadiness {
  healthy: boolean;
  checkedAt: string;
  pairs: PairReadiness[];
  /** "chain/token" for every pair that cannot currently be read. */
  degraded: string[];
}

/** Every chain/token pair the registry claims to support. */
function supportedPairs(): { chain: string; token: string }[] {
  const pairs: { chain: string; token: string }[] = [];
  for (const chain of Object.keys(PROBE_ADDRESSES)) {
    const adapter = getAdapter(chain);
    if (!adapter) continue;
    for (const token of adapter.supportedTokens) {
      pairs.push({ chain, token: token.toLowerCase() });
    }
  }
  return pairs;
}

/**
 * Probe every pair's balance read. Never throws — a missing report reads as
 * "fine" downstream, so a failed probe must be a result, not an exception.
 */
export async function checkChainReadiness(): Promise<ChainReadiness> {
  const pairs = await Promise.all(
    supportedPairs().map(async ({ chain, token }): Promise<PairReadiness> => {
      const started = Date.now();
      try {
        const adapter = getAdapter(chain);
        if (!adapter) throw new Error("no adapter registered");
        await adapter.getBalanceSnapshot(PROBE_ADDRESSES[chain], token);
        return { chain, token, ok: true, durationMs: Date.now() - started };
      } catch (err) {
        return {
          chain,
          token,
          ok: false,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
          durationMs: Date.now() - started,
        };
      }
    }),
  );

  const degraded = pairs.filter((p) => !p.ok).map((p) => `${p.chain}/${p.token}`);

  return {
    healthy: degraded.length === 0,
    checkedAt: new Date().toISOString(),
    pairs,
    degraded,
  };
}
