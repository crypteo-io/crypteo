import axios from "axios";
import {
  classifyAmount,
  confirmationsFromAge,
  requiredConfirmations,
} from "./config";
import type {
  ChainAdapter,
  CheckPaymentParams,
  PaymentCheckResult,
} from "./interface";

import { cachedRead } from "./reads";
import { defineEndpoints, resolveEndpoints, withEndpointFailover } from "./rpc";

// Esplora API. Override with BTC_API_URLS.
const DEFAULT_BASE_URLS = defineEndpoints("BTC_API_URLS", [
  "https://mempool.space/api",
  "https://blockstream.info/api",
]);

const RPC_ENV = "BTC_API_URLS";

/**
 * GET `path` from the first endpoint returning a usable body. These endpoints
 * answer overload with a 200 carrying HTML, so an unvalidated body would be
 * accepted as data and the healthy fallback never tried.
 */
async function fetchWithFallback<T>(
  path: string,
  validate: (data: unknown) => data is T,
): Promise<T> {
  return withEndpointFailover(
    RPC_ENV,
    resolveEndpoints(RPC_ENV, DEFAULT_BASE_URLS),
    `btc ${path}`,
    async ({ url, agent }) => {
      const res = await axios.get(`${url}${path}`, {
        timeout: 6_000,
        httpsAgent: agent,
        httpAgent: agent,
        proxy: false,
        validateStatus: () => true,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      if (!validate(res.data)) {
        throw new Error(
          `unexpected response shape: ${JSON.stringify(res.data).slice(0, 160)}`,
        );
      }
      return res.data;
    },
  );
}

interface BtcAddressStats {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

function isAddressStats(data: unknown): data is BtcAddressStats {
  const stats = (data as BtcAddressStats | null)?.chain_stats;
  return (
    typeof data === "object" &&
    data !== null &&
    typeof stats?.funded_txo_sum === "number" &&
    typeof stats?.spent_txo_sum === "number"
  );
}

/**
 * Snapshot basis for new sessions: the confirmed balance (funded − spent).
 *
 * Sessions used to snapshot lifetime receipts (funded_txo_sum). That counts
 * change returned to the address: a merchant spending from a single-address
 * wallet raised it by the change, and attribution — closest session, no upper
 * bound — marked an unrelated buyer's session paid. A spend only ever lowers
 * the balance. Rows with no basis (opened before the switch) keep the legacy
 * comparison, so no session is compared against a snapshot in other units.
 */
export const BTC_SNAPSHOT_BASIS = "balance";

/** Confirmed satoshis under the session's basis. */
function satsFor(
  stats: BtcAddressStats,
  basis: string | null | undefined,
): number {
  const { funded_txo_sum, spent_txo_sum } = stats.chain_stats;
  return basis === BTC_SNAPSHOT_BASIS
    ? funded_txo_sum - spent_txo_sum
    : funded_txo_sum;
}

function isTxList(data: unknown): data is BtcTx[] {
  return Array.isArray(data);
}

function isTipHeight(data: unknown): data is number {
  return typeof data === "number" && Number.isFinite(data);
}

interface BtcTx {
  txid: string;
  status?: { block_height?: number; block_time?: number };
  vin?: { prevout?: { scriptpubkey_address?: string } | null }[];
  vout?: { scriptpubkey_address?: string; value: number }[];
}

/** Satoshis `tx` pays to `address`. */
function satsPaidTo(tx: BtcTx, address: string): number {
  return (tx.vout ?? [])
    .filter((out) => out.scriptpubkey_address === address)
    .reduce((sum, out) => sum + out.value, 0);
}

export const btcAdapter: ChainAdapter = {
  chain: "btc",
  supportedTokens: ["BTC"],
  snapshotBasis: BTC_SNAPSHOT_BASIS,

  async getBalanceSnapshot(address: string): Promise<number> {
    const data = await fetchWithFallback(`/address/${address}`, isAddressStats);
    return satsFor(data, BTC_SNAPSHOT_BASIS) / 1e8;
  },

  async checkPayment(params: CheckPaymentParams): Promise<PaymentCheckResult> {
    const {
      address,
      expectedAmount,
      balanceSnapshot,
      firstDetectedAt,
      confirmedFrom,
      createdAt,
      existingTxHash,
      snapshotBasis,
    } = params;
    // Shared per cycle by every session on the address.
    const data = await cachedRead(params.reads, `btc:stats:${address}`, () =>
      fetchWithFallback(`/address/${address}`, isAddressStats),
    );

    const currentSats = satsFor(data, snapshotBasis);
    const snapshotSats = Math.round(balanceSnapshot * 1e8);
    const receivedSats = currentSats - snapshotSats;

    if (receivedSats <= 0) return { detected: false };

    const received = receivedSats / 1e8;
    const status = classifyAmount(received, expectedAmount, confirmedFrom);

    // Must not be able to fail a detection that already succeeded.
    let txs: BtcTx[] = [];
    try {
      txs = await cachedRead(params.reads, `btc:txs:${address}`, () =>
        fetchWithFallback(`/address/${address}/txs`, isTxList),
      );
    } catch (err) {
      console.warn(
        `[btc] tx history unavailable for ${address}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // The confirmed payment to this address whose value is closest to what
    // arrived. Never the merchant's own spend (txs[0] is routinely their sweep,
    // and its change output "pays" the address), never a tx that predates the
    // session (block times are miner-set, so generous slack), and never a
    // replacement for a hash already attributed — the alternative may be a
    // later session's deposit, which the txHash dedupe then refuses forever.
    const since = createdAt.getTime() / 1000 - 3600;
    const latestTx = existingTxHash
      ? txs.find((tx) => tx.txid === existingTxHash)
      : txs
          .filter(
            (tx) =>
              !!tx.status?.block_height &&
              (tx.status.block_time ?? 0) >= since &&
              satsPaidTo(tx, address) > 0 &&
              !tx.vin?.some(
                (input) => input.prevout?.scriptpubkey_address === address,
              ),
          )
          .sort(
            (a, b) =>
              Math.abs(satsPaidTo(a, address) - receivedSats) -
              Math.abs(satsPaidTo(b, address) - receivedSats),
          )[0];
    const txHash = existingTxHash ?? latestTx?.txid;
    let confirmations = 0;
    let finalStatus = "confirming" as PaymentCheckResult["status"];

    if (latestTx?.status?.block_height) {
      try {
        const tip = await cachedRead(params.reads, "btc:tip", () =>
          fetchWithFallback("/blocks/tip/height", isTipHeight),
        );
        confirmations = tip - latestTx.status.block_height + 1;
      } catch (err) {
        console.warn(
          "[btc] tip height unavailable:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Floor confirmations by how long we've observed the deposit, so a tx whose
    // block height we can't read never pins the session in "confirming".
    confirmations = Math.max(
      confirmations,
      confirmationsFromAge("btc", firstDetectedAt),
    );

    if (confirmations >= requiredConfirmations("btc")) {
      finalStatus = status;
    }

    return {
      detected: true,
      receivedAmount: received,
      currentBalance: currentSats / 1e8,
      txHash,
      confirmations,
      status: finalStatus,
    };
  },
};
