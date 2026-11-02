import axios from "axios";
import { balanceDelta, classifyAmount } from "./config";
import { cachedRead } from "./reads";
import type {
  ChainAdapter,
  CheckPaymentParams,
  PaymentCheckResult,
  TaggedTransfer,
} from "./interface";

import {
  defineEndpoints,
  resolveEndpoints,
  withEndpointFailover,
} from "./rpc";

// Override with XRP_RPC_URLS.
const DEFAULT_RPC_URLS = defineEndpoints("XRP_RPC_URLS", [
  "https://xrplcluster.com",
  "https://s1.ripple.com:51234",
  "https://s2.ripple.com:51234",
  "https://xrpl.ws",
]);

const RPC_ENV = "XRP_RPC_URLS";

/**
 * A real answer about the ledger rather than an endpoint problem: not worth
 * failing over, and not the proxy's fault.
 */
const LEDGER_ANSWER_PATTERNS = [
  "actnotfound",
  "account not found",
  "actmalformed",
  "account malformed",
];

export function isLedgerAnswer(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return LEDGER_ANSWER_PATTERNS.some((p) => msg.includes(p));
}

/**
 * The one ledger answer that is a real zero: the account is unactivated.
 * "Malformed" is not: it means the address isn't an XRP address at all. Reading
 * it as 0 opened checkouts on a Solana address saved as an XRP wallet, and
 * every poll then failed until the session expired (2026-10-14).
 */
export function isAccountNotFound(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("actnotfound") || msg.includes("account not found");
}

interface XrpRpcError {
  error?: string;
  error_message?: string;
}

interface XrpAccountInfo {
  account_data: { Balance: string };
}

type XrpAmount = string | { currency: string; value: string; issuer: string };

// Ripple epoch (2000-01-01) to Unix seconds.
const RIPPLE_EPOCH_OFFSET = 946_684_800;

interface XrpTransaction {
  hash?: string;
  TransactionType?: string;
  Destination?: string;
  DestinationTag?: number;
  Amount?: XrpAmount;
  date?: number;
}

interface XrpTxEntry {
  tx?: XrpTransaction;
  tx_json?: XrpTransaction;
  hash?: string;
  meta?: { delivered_amount?: XrpAmount };
}

interface XrpAccountTx {
  transactions?: XrpTxEntry[];
}

async function xrpRpcRequest<T>(
  method: string,
  params: Record<string, unknown>[],
): Promise<T> {
  return withEndpointFailover(
    RPC_ENV,
    resolveEndpoints(RPC_ENV, DEFAULT_RPC_URLS),
    `xrp ${method}`,
    async ({ url, agent }) => {
      const res = await axios.post(
        url,
        { method, params },
        {
          httpAgent: agent,
          httpsAgent: agent,
          proxy: false,
          timeout: 8_000,
          validateStatus: () => true, // Parse XRPL error objects even on 4xx/5xx
        },
      );

      const data = res.data as { result?: (T & XrpRpcError) | null };
      const result = data.result;
      if (res.status >= 400 || result?.error) {
        throw new Error(
          result?.error_message || result?.error || res.statusText,
        );
      }
      return result as T;
    },
    { isFatal: isLedgerAnswer },
  );
}

export const xrpAdapter: ChainAdapter = {
  chain: "xrp",
  supportedTokens: ["XRP"],

  async getBalanceSnapshot(address: string): Promise<number> {
    try {
      const result = await xrpRpcRequest<XrpAccountInfo>("account_info", [
        {
          account: address,
          ledger_index: "validated",
        },
      ]);
      const drops = result.account_data.Balance;
      return parseInt(drops, 10) / 1e6;
    } catch (err: unknown) {
      // Only an unactivated account is a real zero.
      if (isAccountNotFound(err)) return 0;
      throw err;
    }
  },

  async checkPayment(params: CheckPaymentParams): Promise<PaymentCheckResult> {
    const {
      address,
      expectedAmount,
      balanceSnapshot,
      xrpDestinationTag,
      confirmedFrom,
    } = params;

    // ── Strategy: Tag-based transaction matching (when tag is set) ──
    // When a destination tag is configured, we filter transactions by tag
    // to accurately credit the right payment. This is critical for shared
    // wallet setups used by exchanges and services.
    //
    // When no tag is set, we fall back to balance-diff detection for
    // simple wallet-to-wallet transfers.

    // A tag is preferred but cannot be required: a buyer withdrawing from a
    // custodial exchange may not be able to set one, and a deposit that arrives
    // untagged must still be detected. When no tagged transaction is found we
    // fall through to balance-diff detection, which is non-exclusive and so
    // still gets arbitrated by cross-session attribution.
    if (xrpDestinationTag) {
      const byTag = await this._checkPaymentWithTag(
        address,
        expectedAmount,
        xrpDestinationTag,
        params.createdAt,
        confirmedFrom,
      );
      if (byTag.detected) return byTag;
    }

    // ── Fallback: Balance-diff detection (no tag / untagged deposit) ──
    // Shared per cycle by every session on the address.
    const currentBalance = await cachedRead(
      params.reads,
      `xrp:balance:${address}`,
      () => this.getBalanceSnapshot(address),
    );
    const received = balanceDelta(currentBalance, balanceSnapshot);

    if (received <= 0) return { detected: false };

    const status = classifyAmount(received, expectedAmount, confirmedFrom);

    let txHash: string | undefined = undefined;
    const confirmations = 1;
    let reserved: TaggedTransfer[] | undefined;
    const otherTags = new Set(
      (params.walletTags ?? []).filter((t) => t !== xrpDestinationTag),
    );

    try {
      const result = await cachedRead(
        params.reads,
        `xrp:account_tx:${address}:20`,
        () =>
          xrpRpcRequest<XrpAccountTx>("account_tx", [
            {
              account: address,
              limit: 20,
            },
          ]),
      );
      const transactions = result.transactions || [];
      const isPayment = (tx: XrpTransaction | undefined) =>
        tx?.TransactionType === "Payment" && tx.Destination === address;
      const taggedForOther = (tx: XrpTransaction | undefined) =>
        tx?.DestinationTag !== undefined && otherTags.has(String(tx.DestinationTag));

      // Deposits carrying another session's tag: that session's money, kept
      // out of this fallback's figure by attribution.
      reserved = transactions.flatMap((entry) => {
        const tx = entry.tx || entry.tx_json;
        if (!isPayment(tx) || !taggedForOther(tx) || tx?.date === undefined) return [];
        const delivered = entry.meta?.delivered_amount ?? tx.Amount;
        if (typeof delivered !== "string") return []; // issued currency
        const drops = parseInt(delivered, 10);
        if (!(drops > 0)) return [];
        return [
          {
            amount: drops / 1e6,
            at: new Date((tx.date + RIPPLE_EPOCH_OFFSET) * 1000),
            tag: String(tx.DestinationTag),
            txHash: tx.hash || entry.hash,
          },
        ];
      });

      // Most recent transaction that actually PAYS this address. `account_tx`
      // returns everything touching the account — including the merchant's own
      // outgoing Payments and non-Payment types like TrustSet — so taking
      // entry[0] would routinely record the merchant's own sweep as the
      // buyer's transaction. Never one tagged for another session.
      const incoming = transactions.find((entry) => {
        const tx = entry.tx || entry.tx_json;
        return isPayment(tx) && !taggedForOther(tx);
      });
      if (incoming) {
        const tx = incoming.tx || incoming.tx_json;
        txHash = tx?.hash || incoming.hash;
      }
    } catch (err) {
      // Non-fatal: only the explorer link is lost.
      console.warn(
        "[xrp] txHash resolution failed:",
        err instanceof Error ? err.message : err,
      );
    }

    return {
      detected: true,
      receivedAmount: received,
      currentBalance,
      txHash,
      confirmations,
      status,
      reserved,
    };
  },

  /**
   * Check for payment using XRP Destination Tag filtering.
   * Scans recent transactions for incoming payments that match the expected
   * destination tag and were created after the payment was initiated.
   */
  async _checkPaymentWithTag(
    address: string,
    expectedAmount: number,
    destinationTag: string,
    createdAt: Date,
    confirmedFrom?: number,
  ): Promise<PaymentCheckResult> {
    const tagNum = parseInt(destinationTag, 10);

    // Errors propagate: "could not read" must not read as "no tagged deposit
    // exists".
    {
      const result = await xrpRpcRequest<XrpAccountTx>("account_tx", [
        {
          account: address,
          limit: 20,
        },
      ]);
      const transactions = result.transactions || [];

      // Filter for incoming Payment transactions with matching destination tag
      let totalReceived = 0;
      let matchingTxHash: string | undefined;

      for (const entry of transactions) {
        const tx = entry.tx || entry.tx_json;
        if (!tx) continue;

        // Must be a Payment type transaction
        if (tx.TransactionType !== "Payment") continue;

        // Must be incoming (Destination matches our address)
        if (tx.Destination !== address) continue;

        // Must have the matching destination tag
        if (tx.DestinationTag !== tagNum) continue;

        // Check transaction date — only count txs after payment creation
        // XRPL uses "Ripple Epoch" (seconds since 2000-01-01T00:00:00Z)
        const rippleEpochOffset = 946684800; // seconds between Unix epoch and Ripple epoch
        const txDate = tx.date;
        if (txDate) {
          const txUnixTime = (txDate + rippleEpochOffset) * 1000;
          if (txUnixTime < createdAt.getTime()) continue;
        }

        // Extract amount (handle both drops string and complex issued currency)
        const deliveredAmount = entry.meta?.delivered_amount || tx.Amount;
        let amountXrp = 0;
        if (typeof deliveredAmount === "string") {
          // Native XRP in drops
          amountXrp = parseInt(deliveredAmount, 10) / 1e6;
        } else if (
          typeof deliveredAmount === "object" &&
          deliveredAmount !== null
        ) {
          // Issued currency — skip for native XRP payments
          continue;
        }

        totalReceived += amountXrp;
        if (!matchingTxHash) {
          matchingTxHash = tx.hash || entry.hash;
        }
      }

      if (totalReceived <= 0) return { detected: false };

      const status = classifyAmount(totalReceived, expectedAmount, confirmedFrom);

      return {
        detected: true,
        receivedAmount: totalReceived,
        exclusive: true,
        txHash: matchingTxHash,
        confirmations: 1,
        status,
      };
    }
  },
} as ChainAdapter & {
  _checkPaymentWithTag: (
    address: string,
    expectedAmount: number,
    destinationTag: string,
    createdAt: Date,
    confirmedFrom?: number,
  ) => Promise<PaymentCheckResult>;
};
