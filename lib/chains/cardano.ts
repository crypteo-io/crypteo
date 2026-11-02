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
const DEFAULT_API_URLS = defineEndpoints("KOIOS_API_URLS", ["https://api.koios.rest/api/v1"]);
const API_ENV = "KOIOS_API_URLS";

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

const DIGITS_RE = /^\d+$/;

/**
 * address_info answers with an array: one entry per address the chain has
 * seen, and `[]` for one it never has — that, and only that, is a zero.
 */
function isAddressInfoList(data: unknown): data is KoiosAddressInfo[] {
  return (
    Array.isArray(data) &&
    data.every(
      (d) =>
        typeof d === "object" &&
        d !== null &&
        typeof (d as KoiosAddressInfo).balance === "string" &&
        DIGITS_RE.test((d as KoiosAddressInfo).balance),
    )
  );
}

function isTip(data: unknown): data is KoiosTip[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof (data[0] as KoiosTip).block_no === "number"
  );
}

export function headersFor(url: string): Record<string, string> {
  // A credential: only ever sent to Koios itself.
  const token = process.env.KOIOS_API_TOKEN;
  return token && new URL(url).hostname.endsWith("koios.rest")
    ? { Authorization: `Bearer ${token}` }
    : {};
}

async function koios<T>(
  label: string,
  path: string,
  body: Record<string, unknown> | undefined,
  validate: (data: unknown) => data is T,
): Promise<T> {
  return withEndpointFailover(
    API_ENV,
    resolveEndpoints(API_ENV, DEFAULT_API_URLS),
    `ada ${label}`,
    async ({ url, agent }: RpcAttempt) => {
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
    },
  );
}

async function readAddress(address: string): Promise<KoiosAddressInfo | null> {
  const list = await koios(
    "address_info",
    "/address_info",
    { _addresses: [address] },
    isAddressInfoList,
  );
  return list[0] ?? null;
}

export const cardanoAdapter: ChainAdapter = {
  chain: "ada",
  supportedTokens: ["ADA"],

  async getBalanceSnapshot(address: string): Promise<number> {
    const info = await readAddress(address);
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

    // Throws on failure: an unreadable address is not an empty one.
    // Shared per cycle by every session on the address.
    const info = await cachedRead(params.reads, `ada:address:${address}`, () =>
      readAddress(address),
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
        const [tip] = await cachedRead(params.reads, "ada:tip", () =>
          koios("tip", "/tip", undefined, isTip),
        );
        confirmations = Math.max(0, tip.block_no - deposit.block_height + 1);
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
