import axios from "axios";
import {
  concat,
  decodeBase58,
  encodeBase58,
  getBytes,
  hexlify,
  sha256,
  toBeArray,
} from "ethers";
import {
  balanceDelta,
  classifyAmount,
  confirmationsFromAge,
  requiredConfirmations,
  shouldRedetectUnderpaid,
  TRON_TOKEN_CONTRACTS,
} from "./config";
import { cachedRead } from "./reads";
import type {
  ChainAdapter,
  CheckPaymentParams,
  PaymentCheckResult,
} from "./interface";

import {
  defineEndpoints,
  type RpcAttempt,
  resolveEndpoints,
  withEndpointFailover,
} from "./rpc";

// Full-node HTTP API (/wallet/*): balances. Probed 2026-10-12: both answer
// getaccount and triggerconstantcontract without a key; tron.drpc.org and
// ankr refuse the HTTP API on free plans. Override with TRON_RPC_URLS.
const DEFAULT_RPC_URLS = defineEndpoints("TRON_RPC_URLS", [
  "https://api.trongrid.io",
  "https://tron-rpc.publicnode.com",
]);
const RPC_ENV = "TRON_RPC_URLS";

// Indexed API (/v1/accounts/…/transactions, /walletsolidity/*): transaction
// lookup only. TronGrid is the only public indexer — publicnode 404s /v1 and
// answers {} for transaction info it doesn't keep. Override with
// TRON_INDEXER_URLS.
const DEFAULT_INDEXER_URLS = defineEndpoints("TRON_INDEXER_URLS", [
  "https://api.trongrid.io",
]);
const INDEXER_ENV = "TRON_INDEXER_URLS";

const SUN_PER_TRX = 1e6;

interface TronAccount {
  address?: string;
  balance?: number;
  Error?: string;
}

interface TronConstantResult {
  constant_result?: string[];
  result?: { result?: boolean; message?: string };
}

interface Trc20Transfer {
  transaction_id: string;
  from: string;
  to: string;
  value: string;
}

interface TronTx {
  txID: string;
  ret?: { contractRet?: string }[];
  raw_data?: {
    contract?: {
      type?: string;
      parameter?: {
        value?: {
          amount?: number;
          owner_address?: string;
          to_address?: string;
        };
      };
    }[];
  };
}

interface TronTxInfo {
  id?: string;
  receipt?: { result?: string };
}

/** 21-byte hex form (41…) of a base58 Tron address, as /v1 and txs report it. */
export function tronAddressToHex(address: string): string {
  const bytes = toBeArray(decodeBase58(address));
  if (bytes.length !== 25 || bytes[0] !== 0x41) {
    throw new Error(`Invalid address: ${address} is not a Tron address`);
  }
  return hexlify(bytes.slice(0, 21)).slice(2);
}

/** Base58 form of a 41… hex address. */
export function tronHexToAddress(hex: string): string {
  const raw = getBytes(`0x${hex.replace(/^0x/, "")}`);
  const checksum = getBytes(sha256(sha256(raw))).slice(0, 4);
  return encodeBase58(concat([raw, checksum]));
}

export function headersFor(url: string): Record<string, string> {
  // TronGrid throttles anonymous callers hard; a free key lifts that. Only
  // ever sent to TronGrid — it is a credential.
  const key = process.env.TRON_API_KEY;
  return key && new URL(url).hostname.endsWith("trongrid.io")
    ? { "TRON-PRO-API-KEY": key }
    : {};
}

async function tronRequest<T>(
  attempt: RpcAttempt,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = attempt.url.replace(/\/$/, "");
  const res = await axios({
    url: `${url}${path}`,
    method,
    data: body,
    headers: { "content-type": "application/json", ...headersFor(url) },
    httpsAgent: attempt.agent,
    httpAgent: attempt.agent,
    proxy: false,
    timeout: 8_000,
    validateStatus: () => true,
  });
  if (res.status === 429) throw new Error("HTTP 429 Too Many Requests");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  // Same overload failure mode as the Esplora/Blockbook APIs: a 200 with HTML.
  if (typeof res.data !== "object" || res.data === null) {
    throw new Error(
      `unexpected response shape: ${String(res.data).slice(0, 160)}`,
    );
  }
  return res.data as T;
}

function rpc<T>(
  label: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return withEndpointFailover(
    RPC_ENV,
    resolveEndpoints(RPC_ENV, DEFAULT_RPC_URLS),
    `tron ${label}`,
    (attempt) => tronRequest<T>(attempt, method, path, body),
  );
}

function indexer<T>(
  label: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return withEndpointFailover(
    INDEXER_ENV,
    resolveEndpoints(INDEXER_ENV, DEFAULT_INDEXER_URLS),
    `tron ${label}`,
    (attempt) => tronRequest<T>(attempt, method, path, body),
  );
}

/**
 * TRX or TRC-20 balance. Throws on anything but a recognised answer: only an
 * account the node explicitly doesn't know (`{}` — never activated) is zero.
 */
async function readBalance(address: string, token: string): Promise<number> {
  const lowerToken = token.toLowerCase();

  if (lowerToken === "trx") {
    const account = await rpc<TronAccount>(
      "getaccount",
      "POST",
      "/wallet/getaccount",
      {
        address,
        visible: true,
      },
    );
    if (account.Error) throw new Error(account.Error);
    // An unactivated account is returned as an empty object.
    if (Object.keys(account).length === 0) return 0;
    if (typeof account.address !== "string") {
      throw new Error(
        `unexpected getaccount shape: ${JSON.stringify(account).slice(0, 160)}`,
      );
    }
    // `balance` is omitted, not 0, on an activated account holding no TRX.
    return (account.balance ?? 0) / SUN_PER_TRX;
  }

  const tokenConfig = TRON_TOKEN_CONTRACTS[lowerToken];
  if (!tokenConfig) {
    throw new Error(`No TRC-20 configuration for token "${token}" on tron`);
  }
  // balanceOf(address): the argument is the 20-byte address, left-padded.
  const parameter = tronAddressToHex(address).slice(2).padStart(64, "0");
  const res = await rpc<TronConstantResult>(
    "balanceOf",
    "POST",
    "/wallet/triggerconstantcontract",
    {
      owner_address: address,
      contract_address: tokenConfig.contract,
      function_selector: "balanceOf(address)",
      parameter,
      visible: true,
    },
  );
  const hex = res.constant_result?.[0];
  if (
    res.result?.result !== true ||
    typeof hex !== "string" ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    throw new Error(
      `balanceOf failed: ${res.result?.message ?? JSON.stringify(res).slice(0, 160)}`,
    );
  }
  return Number(BigInt(`0x${hex}`)) / 10 ** tokenConfig.decimals;
}

/** A transfer resolved from TronGrid's index: hash, sender, and finality. */
interface ResolvedTransfer {
  hash: string;
  from?: string;
  solidified: boolean;
}

/**
 * The incoming transfer of `token` since the session opened whose value is
 * closest to `received`. Closest, not newest: poisoning bots answer a real
 * transfer with dust from a lookalike address within seconds, and "newest"
 * would name the attacker's tx and sender.
 *
 * Queries solidified (irreversible) transfers first; a hit there means the
 * deposit is final, which on Tron is exactly the 19-block requirement. Falls
 * back to the unconfirmed view for the hash alone.
 */
async function findIncomingTransfer(
  address: string,
  token: string,
  createdAt: Date,
  received: number,
): Promise<ResolvedTransfer | null> {
  const lowerToken = token.toLowerCase();
  // Slack for clock skew between us and block timestamps.
  const since = createdAt.getTime() - 120_000;

  for (const solidified of [true, false]) {
    const filter = solidified ? "only_confirmed=true" : "only_unconfirmed=true";

    if (lowerToken === "trx") {
      const res = await indexer<{ data?: TronTx[] }>(
        "account txs",
        "GET",
        `/v1/accounts/${address}/transactions?only_to=true&${filter}&min_timestamp=${since}&limit=20`,
      );
      const ownHex = tronAddressToHex(address).toLowerCase();
      let best: ResolvedTransfer | null = null;
      let bestGap = Infinity;
      for (const tx of res.data ?? []) {
        const contract = tx.raw_data?.contract?.[0];
        const value = contract?.parameter?.value;
        if (
          contract?.type !== "TransferContract" ||
          tx.ret?.[0]?.contractRet !== "SUCCESS" ||
          value?.to_address?.toLowerCase() !== ownHex ||
          !((value.amount ?? 0) > 0)
        ) {
          continue;
        }
        const gap = Math.abs((value.amount ?? 0) / SUN_PER_TRX - received);
        if (gap < bestGap) {
          bestGap = gap;
          best = {
            hash: tx.txID,
            from: value.owner_address
              ? tronHexToAddress(value.owner_address)
              : undefined,
            solidified,
          };
        }
      }
      if (best) return best;
      continue;
    }

    const tokenConfig = TRON_TOKEN_CONTRACTS[lowerToken];
    if (!tokenConfig) return null;
    const res = await indexer<{ data?: Trc20Transfer[] }>(
      "trc20 txs",
      "GET",
      `/v1/accounts/${address}/transactions/trc20?only_to=true&${filter}&contract_address=${tokenConfig.contract}&min_timestamp=${since}&limit=20`,
    );
    const amountOf = (t: Trc20Transfer) =>
      Number(BigInt(/^\d+$/.test(t.value) ? t.value : "0")) /
      10 ** tokenConfig.decimals;
    const hit = (res.data ?? [])
      .filter((t) => t.to === address && amountOf(t) > 0)
      .sort(
        (a, b) =>
          Math.abs(amountOf(a) - received) - Math.abs(amountOf(b) - received),
      )[0];
    if (hit) return { hash: hit.transaction_id, from: hit.from, solidified };
  }
  return null;
}

/** Whether a known transaction is solidified. Null when the node can't say. */
async function isSolidified(txHash: string): Promise<boolean | null> {
  const info = await indexer<TronTxInfo>(
    "solidity txinfo",
    "POST",
    "/walletsolidity/gettransactioninfobyid",
    { value: txHash },
  );
  // {} means "not in the solidified ledger (yet)" on TronGrid, but some nodes
  // answer {} for anything they don't index — never read it as a failure.
  if (!info.id) return null;
  const result = info.receipt?.result;
  return result === undefined || result === "SUCCESS";
}

export const tronAdapter: ChainAdapter = {
  chain: "tron",
  supportedTokens: [
    "TRX",
    ...Object.keys(TRON_TOKEN_CONTRACTS).map((t) => t.toUpperCase()),
  ],

  async getBalanceSnapshot(address: string, token: string): Promise<number> {
    return readBalance(address, token);
  },

  async checkPayment(params: CheckPaymentParams): Promise<PaymentCheckResult> {
    const {
      address,
      expectedAmount,
      token,
      balanceSnapshot,
      createdAt,
      existingTxHash,
      creditedAmount,
      firstDetectedAt,
      confirmedFrom,
      currentStatus,
    } = params;
    const reqConfs = requiredConfirmations("tron", token);

    // ── Re-confirmation ──
    // Like EVM: once attributed, follow the hash rather than the balance, so
    // the merchant sweeping the wallet can't strand the session.
    // Not once a short credit has settled as underpaid — see
    // shouldRedetectUnderpaid; dust sends credited first are endemic on Tron.
    if (
      existingTxHash &&
      creditedAmount &&
      creditedAmount > 0 &&
      !shouldRedetectUnderpaid(
        currentStatus,
        creditedAmount,
        expectedAmount,
        confirmedFrom,
      )
    ) {
      try {
        if (await isSolidified(existingTxHash)) {
          return {
            detected: true,
            receivedAmount: creditedAmount,
            exclusive: true, // already attributed — don't re-run the matcher
            txHash: existingTxHash,
            confirmations: reqConfs,
            status: classifyAmount(
              creditedAmount,
              expectedAmount,
              confirmedFrom,
            ),
          };
        }
      } catch (err) {
        console.warn("[tron] Re-confirmation lookup failed:", err);
      }
    }

    // Shared per cycle by every session on the address.
    const currentBalance = await cachedRead(
      params.reads,
      `tron:balance:${address}:${token.toLowerCase()}`,
      () => readBalance(address, token),
    );
    const received = balanceDelta(currentBalance, balanceSnapshot);
    if (received <= 0) return { detected: false };

    const status = classifyAmount(received, expectedAmount, confirmedFrom);

    // An attributed hash is never swapped: "newest" would otherwise become a
    // later session's deposit, which the txHash dedupe then refuses forever.
    let transfer: ResolvedTransfer | null = null;
    try {
      if (!existingTxHash) {
        transfer = await findIncomingTransfer(
          address,
          token,
          createdAt,
          received,
        );
      }
    } catch (err) {
      // Non-fatal: must never fail a detection that already succeeded.
      console.warn(
        "[tron] txHash resolution failed:",
        err instanceof Error ? err.message : err,
      );
    }

    const confirmations = Math.max(
      transfer?.solidified ? reqConfs : 0,
      confirmationsFromAge("tron", firstDetectedAt),
    );

    return {
      detected: true,
      receivedAmount: received,
      currentBalance,
      txHash: transfer?.hash ?? existingTxHash,
      fromAddress: transfer?.from,
      confirmations,
      status: confirmations >= reqConfs ? status : "confirming",
    };
  },
};
