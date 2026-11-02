import { dogeAdapter, zecAdapter } from "./blockbook";
import { btcAdapter } from "./btc";
import { cardanoAdapter } from "./cardano";
import { bscAdapter, evmAdapter, polygonAdapter } from "./evm";
import type { ChainAdapter } from "./interface";
import { solanaAdapter } from "./solana";
import { tronAdapter } from "./tron";
import { xrpAdapter } from "./xrp";

const adapters: Record<string, ChainAdapter> = {
  eth: evmAdapter,
  btc: btcAdapter,
  sol: solanaAdapter,
  xrp: xrpAdapter,
  bsc: bscAdapter,
  polygon: polygonAdapter,
  tron: tronAdapter,
  doge: dogeAdapter,
  zec: zecAdapter,
  ada: cardanoAdapter,
};

export function getAdapter(chain: string): ChainAdapter | undefined {
  return adapters[chain.toLowerCase()];
}

/**
 * Whether an adapter can actually watch this chain/token pair.
 *
 * `supportedTokens` used to be declarative only — nothing checked it — so a
 * session could be created on a pair no adapter could see. The session then
 * simply never detected anything and silently expired, with the buyer's funds
 * already sent. Assignment must reject the pair up front instead.
 */
export function isSupportedPair(chain: string, token: string): boolean {
  const adapter = getAdapter(chain);
  if (!adapter) return false;
  return adapter.supportedTokens.some(
    (t) => t.toLowerCase() === token.toLowerCase(),
  );
}
