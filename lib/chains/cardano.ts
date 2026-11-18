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

import {
  defineEndpoints,
  type RpcAttempt,
  resolveEndpoints,
  withEndpointFailover,
} from "./rpc";

// Koios (community-run, PostgREST over db-sync). Probed 2026-10-12: the public
// tier serves address_info and tip without a key; Blockfrost requires one. A
// free Koios token (KOIOS_API_TOKEN) raises the anonymous rate limit. Any
// Koios-compatible base URL works in KOIOS_API_URLS.
const DEFAULT_API_URLS = defineEndpoints("KOIOS_API_URLS", [
  "https://api.koios.rest/api/v1",
]);
const API_ENV = "KOIOS_API_URLS";

// Blockfrost (free tier: 50k requests a day per project) joins the rotation
// when BLOCKFROST_PROJECT_ID is set, so ada never rests on one provider: the
// keyless Koios tier is 5,000 a day and answered 429 (2026-11-09).
export const BLOCKFROST_URL = "https://cardano-mainnet.blockfrost.io/api/v0";

const LOVELACE_PER_ADA = 1e6;

interface KoiosUtxo {
  tx_hash: string;
  value: string;
  block_height: number | null;
  block_time: number;
}

interface KoiosAddressInfo {
  balance: string;
  utxo_set?: KoiosUtxo[];
}

interface KoiosTip {
  block_no: number;
}

interface BlockfrostAmount {
  unit: string;
  quantity: string;
}

interface BlockfrostAddress {
  amount: BlockfrostAmount[];
}

interface BlockfrostUtxo {
  tx_hash: string;
  amount: BlockfrostAmount[];
}

interface BlockfrostAddressTx {
  tx_hash: string;
  block_height: number;
  block_time: number;
}

interface BlockfrostBlock {
  height: number | null;
}

const DIGITS_RE = /^\d+$/;

const isObject = (d: unknown): d is Record<string, unknown> =>
  typeof d === "object" && d !== null;

/**
 * address_info answers with an array: one entry per address the chain has
 * seen, and `[]` for one it never has — that, and only that, is a zero.
 */
function isAddressInfoList(data: unknown): data is KoiosAddressInfo[] {
  return (
    Array.isArray(data) &&
    data.every(
      (d) =>
        isObject(d) &&
        typeof d.balance === "string" &&
        DIGITS_RE.test(d.balance),
    )
  );
}

function isTip(data: unknown): data is KoiosTip[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    isObject(data[0]) &&
    typeof data[0].block_no === "number"
  );
}

const isAmounts = (d: unknown): d is BlockfrostAmount[] =>
  Array.isArray(d) &&
  d.every(
    (a) =>
      isObject(a) &&
      typeof a.unit === "string" &&
      typeof a.quantity === "string" &&
      DIGITS_RE.test(a.quantity),
  );

const isBlockfrostAddress = (d: unknown): d is BlockfrostAddress =>
  isObject(d) && isAmounts(d.amount);

const isBlockfrostUtxos = (d: unknown): d is BlockfrostUtxo[] =>
  Array.isArray(d) &&
  d.every(
    (u) => isObject(u) && typeof u.tx_hash === "string" && isAmounts(u.amount),
  );

const isBlockfrostTxs = (d: unknown): d is BlockfrostAddressTx[] =>
  Array.isArray(d) &&
  d.every(
    (t) =>
      isObject(t) &&
      typeof t.tx_hash === "string" &&
      typeof t.block_height === "number" &&
      typeof t.block_time === "number",
  );

const isBlockfrostBlock = (d: unknown): d is BlockfrostBlock =>
  isObject(d) && (typeof d.height === "number" || d.height === null);

/** Blockfrost's 404 for an address the chain has never seen. */
const isBlockfrostNotFound = (status: number, data: unknown) =>
  status === 404 && isObject(data) && data.status_code === 404;

const lovelaceOf = (amounts: BlockfrostAmount[]) =>
  amounts.find((a) => a.unit === "lovelace")?.quantity ?? "0";

export function headersFor(url: string): Record<string, string> {
  // Credentials: each only ever sent to its own provider.
  const host = new URL(url).hostname;
  const koiosToken = process.env.KOIOS_API_TOKEN;
  if (koiosToken && host.endsWith("koios.rest")) {
    return { Authorization: `Bearer ${koiosToken}` };
  }
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (projectId && host.endsWith("blockfrost.io"))
    return { project_id: projectId };
  return {};
}

const isBlockfrost = (url: string) =>
  new URL(url).hostname.endsWith("blockfrost.io");

/** Koios endpoints, then Blockfrost when a project id is configured. */
function adaEndpoints(): string[] {
  const urls = resolveEndpoints(API_ENV, DEFAULT_API_URLS);
  if (process.env.BLOCKFROST_PROJECT_ID && !urls.some(isBlockfrost))
    urls.push(BLOCKFROST_URL);
  return urls;
}

const NOT_FOUND = Symbol("not found");

/** One request; throws on anything but a 2xx of the expected shape. */
async function request<T>(
  { url, agent }: RpcAttempt,
  path: string,
  body: Record<string, unknown> | undefined,
  validate: (data: unknown) => data is T,
): Promise<T | typeof NOT_FOUND> {
  const base = url.replace(/\/$/, "");
  const res = await axios({
    url: `${base}${path}`,
    method: body ? "POST" : "GET",
    data: body,
    headers: { "content-type": "application/json", ...headersFor(base) },
    httpsAgent: agent,
    httpAgent: agent,
    proxy: false,
    timeout: 8_000,
    validateStatus: () => true,
  });
  if (isBlockfrost(base) && isBlockfrostNotFound(res.status, res.data))
    return NOT_FOUND;
  if (res.status === 429) throw new Error("HTTP 429 Too Many Requests");
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  if (!validate(res.data)) {
    throw new Error(
      `unexpected response shape: ${JSON.stringify(res.data).slice(0, 160)}`,
    );
  }
  return res.data;
}

async function required<T>(pending: Promise<T | typeof NOT_FOUND>): Promise<T> {
  const value = await pending;
  if (value === NOT_FOUND) throw new Error("HTTP 404 Not Found");
  return value;
}

/**
 * Blockfrost's address read in Koios's shape. UTXOs carry no block, so their
 * height and time come from the address's recent transactions; an output
 * older than those is left out, as one that predates any open session.
 */
async function blockfrostAddress(
  attempt: RpcAttempt,
  address: string,
  withUtxos: boolean,
): Promise<KoiosAddressInfo | null> {
  const path = `/addresses/${encodeURIComponent(address)}`;
  const info = await request(attempt, path, undefined, isBlockfrostAddress);
  if (info === NOT_FOUND) return null;
  const balance = lovelaceOf(info.amount);
  if (!withUtxos) return { balance };

  const [utxos, txs] = await Promise.all([
    request(
      attempt,
      `${path}/utxos?order=desc&count=100`,
      undefined,
      isBlockfrostUtxos,
    ),
    required(
      request(
        attempt,
        `${path}/transactions?order=desc&count=100`,
        undefined,
        isBlockfrostTxs,
      ),
    ),
  ]);
  const blocks = new Map(txs.map((t) => [t.tx_hash, t]));
  const utxoSet: KoiosUtxo[] = [];
  for (const u of utxos === NOT_FOUND ? [] : utxos) {
    const tx = blocks.get(u.tx_hash);
    if (!tx) continue;
    utxoSet.push({
      tx_hash: u.tx_hash,
      value: lovelaceOf(u.amount),
      block_height: tx.block_height,
      block_time: tx.block_time,
    });
  }
  return { balance, utxo_set: utxoSet };
}

/** Throws on failure: an unreadable address is not an empty one. */
async function readAddress(
  address: string,
  withUtxos: boolean,
): Promise<KoiosAddressInfo | null> {
  return withEndpointFailover(
    API_ENV,
    adaEndpoints(),
    "ada address_info",
    async (attempt) => {
      if (isBlockfrost(attempt.url))
        return blockfrostAddress(attempt, address, withUtxos);
      const list = await required(
        request(
          attempt,
          "/address_info",
          { _addresses: [address] },
          isAddressInfoList,
        ),
      );
      return list[0] ?? null;
    },
  );
}

async function readTipHeight(): Promise<number> {
  return withEndpointFailover(
    API_ENV,
    adaEndpoints(),
    "ada tip",
    async (attempt) => {
      if (isBlockfrost(attempt.url)) {
        const block = await required(
          request(attempt, "/blocks/latest", undefined, isBlockfrostBlock),
        );
        if (block.height === null)
          throw new Error(
            "unexpected response shape: latest block has no height",
          );
        return block.height;
      }
      const [tip] = await required(request(attempt, "/tip", undefined, isTip));
      return tip.block_no;
    },
  );
}

export const cardanoAdapter: ChainAdapter = {
  chain: "ada",
  supportedTokens: ["ADA"],

  async getBalanceSnapshot(address: string): Promise<number> {
    const info = await readAddress(address, false);
    return info ? Number(BigInt(info.balance)) / LOVELACE_PER_ADA : 0;
  },

  async checkPayment(params: CheckPaymentParams): Promise<PaymentCheckResult> {
    const {
      address,
      expectedAmount,
      balanceSnapshot,
      createdAt,
      existingTxHash,
      firstDetectedAt,
      confirmedFrom,
    } = params;

    // Shared per cycle by every session on the address.
    const info = await cachedRead(params.reads, `ada:address:${address}`, () =>
      readAddress(address, true),
    );
    const currentBalance = info
      ? Number(BigInt(info.balance)) / LOVELACE_PER_ADA
      : 0;
    const received = balanceDelta(currentBalance, balanceSnapshot);
    if (received <= 0) return { detected: false };

    const status = classifyAmount(received, expectedAmount, confirmedFrom);

    // The deposit is still an unspent output at this address unless the
    // merchant already swept it: of the outputs created since the session
    // opened (block_time is in seconds; slack for clock skew), the one whose
    // value is closest to what arrived — the newest can be the merchant's own
    // change or a dust send. An attributed hash is never swapped: another
    // candidate could be a later session's deposit, which the txHash dedupe
    // then refuses forever.
    const utxos = (info?.utxo_set ?? []).filter((u) => u.block_height !== null);
    const since = createdAt.getTime() / 1000 - 120;
    const ada = (u: KoiosUtxo) =>
      DIGITS_RE.test(u.value) ? Number(BigInt(u.value)) / LOVELACE_PER_ADA : 0;
    const deposit = existingTxHash
      ? utxos.find((u) => u.tx_hash === existingTxHash)
      : utxos
          .filter((u) => u.block_time >= since && ada(u) > 0)
          .sort(
            (a, b) =>
              Math.abs(ada(a) - received) - Math.abs(ada(b) - received) ||
              (b.block_height ?? 0) - (a.block_height ?? 0),
          )[0];

    let confirmations = 0;
    if (deposit?.block_height) {
      try {
        const tip = await cachedRead(params.reads, "ada:tip", readTipHeight);
        confirmations = Math.max(0, tip - deposit.block_height + 1);
      } catch (err) {
        // Non-fatal: must never fail a detection that already succeeded.
        console.warn(
          "[ada] tip unavailable:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    confirmations = Math.max(
      confirmations,
      confirmationsFromAge("ada", firstDetectedAt),
    );

    return {
      detected: true,
      receivedAmount: received,
      currentBalance,
      txHash: existingTxHash ?? deposit?.tx_hash,
      confirmations,
      status:
        confirmations >= requiredConfirmations("ada") ? status : "confirming",
    };
  },
};
