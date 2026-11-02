import axios from "axios";
import {
  balanceDelta,
  classifyAmount,
  confirmationsFromAge,
  requiredConfirmations,
} from "./config";
import { cachedRead } from "./reads";
import type {
  ChainAdapter,
  CheckPaymentParams,
  PaymentCheckResult,
} from "./interface";

import { defineEndpoints, resolveEndpoints, withEndpointFailover } from "./rpc";

/**
 * UTXO chains read through a Blockbook indexer (Trezor's explorer backend,
 * `/api/v2`). One API covers Dogecoin and Zcash, and any provider running
 * Blockbook — NowNodes, GetBlock, a self-hosted instance — drops into the
 * endpoint list unchanged.
 *
 * Detection is a diff of the address's CONFIRMED balance — deliberately not
 * `totalReceived`, which the Bitcoin adapter diffs (funded_txo_sum). Lifetime
 * receipts count change: a merchant spending from a single-address wallet
 * (the norm for DOGE light wallets) gets the change back as a new output,
 * `totalReceived` jumps by it, and attribution — which picks the closest
 * session with no upper bound — marks some unrelated buyer's session paid.
 * A spend only ever LOWERS the balance. The cost is the one every other
 * balance-diff chain already carries: a sweep can hide a deposit, which
 * settleUnseenConfirming handles once the deposit was credited.
 */

interface BlockbookAddress {
  /** Confirmed balance in base units; mempool lives in unconfirmedBalance. */
  balance: string;
}

interface BlockbookTx {
  txid: string;
  blockTime?: number;
  blockHeight?: number;
  confirmations?: number;
  vin?: { addresses?: string[] }[];
  vout?: { addresses?: string[]; value?: string }[];
}

interface BlockbookAddressTxs extends BlockbookAddress {
  transactions?: BlockbookTx[];
}

const DIGITS_RE = /^\d+$/;

// These indexers answer overload with a 200 carrying an HTML challenge page.
// Validating the shape is what turns that into a failover instead of data.
function isAddressInfo(data: unknown): data is BlockbookAddress {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as BlockbookAddress).balance === "string" &&
    DIGITS_RE.test((data as BlockbookAddress).balance)
  );
}

function isAddressTxs(data: unknown): data is BlockbookAddressTxs {
  if (!isAddressInfo(data)) return false;
  const txs = (data as BlockbookAddressTxs).transactions;
  return txs === undefined || Array.isArray(txs);
}

export interface BlockbookChain {
  chain: string;
  token: string;
  /** Base units per coin (1e8 for both Dogecoin and Zcash). */
  unitsPerCoin: number;
  rpcEnv: string;
  defaultUrls: readonly string[];
}

/** Coins from Blockbook's integer base-unit string. */
function toCoins(units: string, unitsPerCoin: number): number {
  // Exact up to 2^53 base units (~90M coins at 1e8). Past that the float
  // keeps ~16 significant digits, which balanceDelta is built to tolerate.
  return Number(BigInt(units)) / unitsPerCoin;
}

/**
 * Provider credentials. NowNodes' Blockbooks (e.g. zecbook.nownodes.io) reject
 * any request without an `api-key` header — verified 2026-10-12: 401 "Unknown
 * API_key" without it or with a wrong key, data with a valid one. It is a
 * credential, so it only ever goes to NowNodes itself.
 */
export function headersFor(url: string): Record<string, string> {
  const key = process.env.NOWNODES_API_KEY;
  return key && new URL(url).hostname.endsWith(".nownodes.io")
    ? { "api-key": key }
    : {};
}

/** What `tx` pays to `address`, in coins. */
function paidTo(
  tx: BlockbookTx,
  address: string,
  unitsPerCoin: number,
): number {
  let units = BigInt(0);
  for (const out of tx.vout ?? []) {
    if (
      out.addresses?.includes(address) &&
      out.value &&
      DIGITS_RE.test(out.value)
    ) {
      units += BigInt(out.value);
    }
  }
  return Number(units) / unitsPerCoin;
}

export function createBlockbookAdapter(cfg: BlockbookChain): ChainAdapter {
  defineEndpoints(cfg.rpcEnv, cfg.defaultUrls);
  async function get<T>(
    path: string,
    validate: (data: unknown) => data is T,
  ): Promise<T> {
    return withEndpointFailover(
      cfg.rpcEnv,
      resolveEndpoints(cfg.rpcEnv, cfg.defaultUrls),
      `${cfg.chain} ${path.split("?")[0].replace(/\/[^/]+$/, "/:address")}`,
      async ({ url, agent }) => {
        const base = url.replace(/\/$/, "");
        const res = await axios.get(`${base}${path}`, {
          headers: headersFor(base),
          timeout: 8_000,
          httpsAgent: agent,
          httpAgent: agent,
          proxy: false,
          validateStatus: () => true,
        });
        if (res.status < 200 || res.status >= 300) {
          // Blockbook reports a malformed address as {"error": "..."} with a
          // 400; surface its text so classifySnapshotError sees "invalid
          // address" and answers 400 instead of retrying forever.
          const detail =
            typeof res.data?.error === "string" ? `: ${res.data.error}` : "";
          throw new Error(`HTTP ${res.status} ${res.statusText}${detail}`);
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

  async function readBalance(address: string): Promise<number> {
    const info = await get(
      `/api/v2/address/${encodeURIComponent(address)}?details=basic`,
      isAddressInfo,
    );
    return toCoins(info.balance, cfg.unitsPerCoin);
  }

  return {
    chain: cfg.chain,
    supportedTokens: [cfg.token.toUpperCase()],

    async getBalanceSnapshot(address: string): Promise<number> {
      return readBalance(address);
    },

    async checkPayment(
      params: CheckPaymentParams,
    ): Promise<PaymentCheckResult> {
      const {
        address,
        expectedAmount,
        balanceSnapshot,
        createdAt,
        existingTxHash,
        firstDetectedAt,
        confirmedFrom,
      } = params;

      // One call yields both the balance and the recent transactions. Throws
      // on failure: an unreadable address is not an empty one.
      // Shared per cycle by every session on the address.
      const data = await cachedRead(
        params.reads,
        `${cfg.chain}:address-txs:${address}`,
        () =>
          get(
        `/api/v2/address/${encodeURIComponent(address)}?details=txs&pageSize=25`,
        isAddressTxs,
      ),
      );
      const currentBalance = toCoins(data.balance, cfg.unitsPerCoin);
      const received = balanceDelta(currentBalance, balanceSnapshot);

      if (received <= 0) return { detected: false };

      const status = classifyAmount(received, expectedAmount, confirmedFrom);

      // The CONFIRMED payment to this address whose value is closest to what
      // arrived — not simply the newest, since dust/poisoning sends cluster
      // right after real ones. Excludes the merchant's own spends (change back
      // to self) and mempool txs (the balance is confirmed-only). An
      // attributed hash is never swapped: another candidate could be a later
      // session's deposit, which the txHash dedupe then refuses forever.
      const txs = data.transactions || [];
      // A deposit can't predate the session waiting for it. Block times are
      // miner-set seconds, allowed to trail real time (median-time-past), so
      // the slack is generous: excluding a real deposit costs more than
      // occasionally naming an older one.
      const since = createdAt.getTime() / 1000 - 3600;
      const deposit = existingTxHash
        ? txs.find((tx) => tx.txid === existingTxHash)
        : txs
            .filter(
              (tx) =>
                (tx.confirmations ?? 0) > 0 &&
                (tx.blockTime ?? 0) >= since &&
                !tx.vin?.some((input) => input.addresses?.includes(address)) &&
                paidTo(tx, address, cfg.unitsPerCoin) > 0,
            )
            .sort(
              (a, b) =>
                Math.abs(paidTo(a, address, cfg.unitsPerCoin) - received) -
                Math.abs(paidTo(b, address, cfg.unitsPerCoin) - received),
            )[0];

      const confirmations = Math.max(
        deposit?.confirmations ?? 0,
        confirmationsFromAge(cfg.chain, firstDetectedAt),
      );

      const sender = deposit?.vin?.[0]?.addresses?.[0];

      return {
        detected: true,
        receivedAmount: received,
        currentBalance,
        txHash: existingTxHash ?? deposit?.txid,
        fromAddress: sender,
        confirmations,
        status:
          confirmations >= requiredConfirmations(cfg.chain)
            ? status
            : "confirming",
      };
    },
  };
}

// Probed 2026-10-12: both serve /api/v2 without a key. Trezor's own
// doge1.trezor.io sits behind a Cloudflare challenge that blocks servers, and
// dogeblocks.com returns 502. Override with DOGE_API_URLS (any Blockbook
// base URL, e.g. a NowNodes/GetBlock endpoint with its key in the path).
export const dogeAdapter = createBlockbookAdapter({
  chain: "doge",
  token: "doge",
  unitsPerCoin: 1e8,
  rpcEnv: "DOGE_API_URLS",
  defaultUrls: [
    "https://blockbook.doge.zelcore.io",
    "https://dogecoin.atomicwallet.io",
  ],
});

// Probed 2026-10-12: zelcore's is the only key-free Zcash Blockbook found
// (zec1.trezor.io is Cloudflare-challenged, zecblockexplorer.com 403s). A
// single default endpoint is a single point of failure — configure a second
// via ZEC_API_URLS in production.
export const zecAdapter = createBlockbookAdapter({
  chain: "zec",
  token: "zec",
  unitsPerCoin: 1e8,
  rpcEnv: "ZEC_API_URLS",
  defaultUrls: ["https://blockbook.zec.zelcore.io"],
});
