import {
  Connection,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
  PublicKey,
} from "@solana/web3.js";
import axios from "axios";
import {
  balanceDelta,
  classifyAmount,
  confirmationsFromAge,
  SOL_TOKEN_MINTS,
} from "./config";
import { cachedRead } from "./reads";
import type {
  ChainAdapter,
  CheckPaymentParams,
  PaymentCheckResult,
  TaggedTransfer,
} from "./interface";
import {
  defineEndpoints,
  type RpcAttempt,
  resolveEndpoints,
  withEndpointFailover,
} from "./rpc";

// Probed 2026-09-01: of the free public endpoints only mainnet-beta serves the
// indexed methods that read an SPL balance (drpc gates Solana, ankr needs a
// key, omniatech is down, onfinality rate-limits immediately). publicnode is
// kept because it does serve getBalance/getSignaturesForAddress/getTransaction,
// and rotation now remembers per method — so it carries its share of those
// while indexed reads go to mainnet-beta. Add keyed free tiers (Helius etc.)
// to SOLANA_RPC_URLS to spread the indexed load too.
const DEFAULT_RPC_URLS = defineEndpoints("SOLANA_RPC_URLS", [
  "https://api.mainnet-beta.solana.com",
  "https://solana.publicnode.com",
]);

const RPC_ENV = "SOLANA_RPC_URLS";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// Listing signatures is one call; fetching each transaction is not. Bound the
// fetches — 40 per session per poll is what gets an endpoint to start refusing.
const SIGNATURE_SCAN_LIMIT = 40;
// Bound on memo-candidate fetches when recognising other sessions' deposits.
const MAX_MEMO_FETCHES = 20;
const MAX_TX_FETCHES = 8;

/**
 * Whether a listed signature could carry `memo`, without fetching it.
 * The listing returns memos as "[<len>] <text>"; null means no memo at all,
 * which cannot match. undefined means the endpoint omitted the field.
 */
export function couldCarryMemo(sigMemo: string | null | undefined, memo: string): boolean {
  if (sigMemo === undefined) return true;
  if (sigMemo === null) return false;
  return sigMemo.includes(memo);
}

/**
 * The chain says the account does not exist, as opposed to the endpoint
 * refusing to tell us. Only these may become a zero balance; anything else
 * must throw.
 */
const ACCOUNT_MISSING_PATTERNS = [
  "could not find account",
  "account does not exist",
  "invalid param: could not find account",
  "could not find mint",
  "not a token account",
  "invalid account owner",
];

export function isAccountMissing(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return ACCOUNT_MISSING_PATTERNS.some((p) => msg.includes(p));
}

/** Mint address for `token`, or undefined when it's native SOL. */
function mintFor(token: string | undefined): PublicKey | undefined {
  const mint = SOL_TOKEN_MINTS[(token || "").toLowerCase()];
  return mint ? new PublicKey(mint) : undefined;
}

/**
 * Associated token account for (owner, mint). Derived locally rather than via
 * @solana/spl-token so we don't take on the dependency for one PDA.
 */
function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function makeConnection({ url, agent }: RpcAttempt): Connection {
  return new Connection(url, {
    commitment: "confirmed",
    fetch: async (input, init) => {
      const res = await axios({
        url: input.toString(),
        method: init?.method || "POST",
        data: init?.body,
        headers: init?.headers as Record<string, string> | undefined,
        httpsAgent: agent,
        httpAgent: agent,
        proxy: false,
        timeout: 8_000,
        validateStatus: () => true,
      });
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: res.statusText,
        url: res.config?.url,
        headers: {
          get: (name: string) =>
            res.headers[name] || res.headers[name.toLowerCase()] || null,
          has: (name: string) =>
            !!res.headers[name] || !!res.headers[name.toLowerCase()],
        },
        json: async () => res.data,
        text: async () =>
          typeof res.data === "string" ? res.data : JSON.stringify(res.data),
      } as unknown as Response;
    },
  });
}

/** One RPC call, failing over across endpoints. No up-front health check: the
 * call that matters is the probe. */
export async function solRpc<T>(
  label: string,
  fn: (conn: Connection) => Promise<T>,
): Promise<T> {
  return withEndpointFailover(
    RPC_ENV,
    resolveEndpoints(RPC_ENV, DEFAULT_RPC_URLS),
    `sol ${label}`,
    (attempt) => fn(makeConnection(attempt)),
  );
}

/** Token accounts `owner` holds for `mint`. Throws if no endpoint can answer. */
async function tokenAccountsOf(owner: PublicKey, mint: PublicKey) {
  const { value } = await solRpc("getTokenAccountsByOwner", (conn) =>
    conn.getParsedTokenAccountsByOwner(owner, { mint }),
  );
  return value;
}

/**
 * SPL balance for `mint`. An empty owner lookup means either no token account
 * yet or that `address` is itself one; the direct read settles which.
 *
 * Returns 0 only when the chain says there is no token account. Any other
 * failure propagates — an unreadable balance is not a zero balance.
 */
async function readSplBalance(
  address: PublicKey,
  mint: PublicKey,
): Promise<number> {
  const owned = await tokenAccountsOf(address, mint);
  if (owned.length > 0) {
    return owned.reduce(
      (sum, { account }) =>
        sum + (account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
      0,
    );
  }

  return solRpc("getTokenAccountBalance", async (conn) => {
    try {
      const direct = await conn.getTokenAccountBalance(address);
      return direct.value.uiAmount ?? 0;
    } catch (err) {
      // The merchant has never received this mint. A real zero.
      if (isAccountMissing(err)) return 0;
      throw err;
    }
  });
}

/** Native SOL balance. */
async function readNativeBalance(address: PublicKey): Promise<number> {
  const lamports = await solRpc("getBalance", (conn) =>
    conn.getBalance(address),
  );
  return lamports / 1e9;
}

async function readBalance(
  address: PublicKey,
  mint: PublicKey | undefined,
): Promise<number> {
  return mint ? readSplBalance(address, mint) : readNativeBalance(address);
}

/**
 * The account whose history carries deposits of `mint`. An SPL transfer credits
 * the token account, and the owner wallet is usually not even an account key,
 * so signature lookups must target the ATA.
 */
async function historyAccount(
  address: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const owned = await tokenAccountsOf(address, mint);
  if (owned.length > 0) return owned[0].pubkey;

  // Deriving an ATA from a token account yields an address with no history, so
  // confirm which case this is rather than guessing.
  const isTokenAccount = await solRpc("getTokenAccountBalance", async (conn) => {
    try {
      await conn.getTokenAccountBalance(address);
      return true;
    } catch (err) {
      if (isAccountMissing(err)) return false;
      throw err;
    }
  });

  return isTokenAccount ? address : deriveAta(address, mint);
}

/**
 * Net amount a transaction credits us, from its own pre/post balance records.
 * Zero or negative for the merchant's own outgoing sweep.
 */
function netCredit(
  tx: ParsedTransactionWithMeta,
  owner: PublicKey,
  account: PublicKey,
  mint?: PublicKey,
): number {
  if (!tx.meta) return 0;

  if (mint) {
    const mintStr = mint.toString();
    const ownerStr = owner.toString();
    const isOurs = (rec: {
      mint: string;
      owner?: string;
      accountIndex: number;
    }) =>
      rec.mint === mintStr &&
      (rec.owner === ownerStr ||
        tx.transaction.message.accountKeys[rec.accountIndex]?.pubkey.equals(
          account,
        ));

    const sumFor = (
      records: readonly {
        accountIndex: number;
        mint: string;
        owner?: string;
        uiTokenAmount: { uiAmount: number | null };
      }[],
    ) =>
      records
        .filter(isOurs)
        .reduce((sum, r) => sum + (r.uiTokenAmount.uiAmount ?? 0), 0);

    return (
      sumFor(tx.meta.postTokenBalances ?? []) -
      sumFor(tx.meta.preTokenBalances ?? [])
    );
  }

  const idx = tx.transaction.message.accountKeys.findIndex((k) =>
    k.pubkey.equals(owner),
  );
  if (idx === -1) return 0;
  return (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9;
}

function getParsedTx(signature: string) {
  return solRpc("getParsedTransaction", (conn) =>
    conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 }),
  );
}

function getSignatures(account: PublicKey) {
  return solRpc("getSignaturesForAddress", (conn) =>
    conn.getSignaturesForAddress(account, { limit: SIGNATURE_SCAN_LIMIT }),
  );
}

export const solanaAdapter: ChainAdapter = {
  chain: "sol",
  supportedTokens: ["SOL", "USDC", "USDT"],

  async getBalanceSnapshot(address: string, token?: string): Promise<number> {
    return readBalance(new PublicKey(address), mintFor(token));
  },

  async checkPayment(params: CheckPaymentParams): Promise<PaymentCheckResult> {
    const {
      address,
      expectedAmount,
      token,
      balanceSnapshot,
      solMemoString,
      firstDetectedAt,
      confirmedFrom,
    } = params;
    const pubKey = new PublicKey(address);
    const mint = mintFor(token);

    // Memo attribution for shared wallets. A memo is preferred but cannot be
    // required — buyers withdrawing from a custodial exchange cannot attach one
    // — so no match falls through to balance-diff, which is non-exclusive and
    // gets arbitrated by cross-session attribution.
    if (solMemoString) {
      try {
        const byMemo = await this._checkPaymentWithMemo(
          pubKey,
          expectedAmount,
          solMemoString,
          mint,
          confirmedFrom,
        );
        if (byMemo.detected) return byMemo;
      } catch (err) {
        // Fall through to balance-diff, which is fail-loud: if it cannot read
        // the balance either, it throws and the poll is reported as failed.
        console.warn(
          `[sol] memo scan failed for ${address}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // SPL deposits land in a token account and never touch the native balance,
    // so the read follows the mint.
    // Shared per cycle by every session on the wallet.
    const currentBalance = await cachedRead(
      params.reads,
      `sol:balance:${address}:${mint?.toString() ?? "native"}`,
      () => readBalance(pubKey, mint),
    );
    const sigsOf = (acct: PublicKey) =>
      cachedRead(params.reads, `sol:sigs:${acct.toString()}`, () =>
        getSignatures(acct),
      );
    const txOf = (signature: string) =>
      cachedRead(params.reads, `sol:tx:${signature}`, () =>
        getParsedTx(signature),
      );
    const received = balanceDelta(currentBalance, balanceSnapshot);

    if (received <= 0) return { detected: false };

    const status = classifyAmount(received, expectedAmount, confirmedFrom);

    let txHash: string | undefined;
    let confirmations = confirmationsFromAge("sol", firstDetectedAt);
    let reserved: TaggedTransfer[] | undefined;
    const otherMemos = new Set(
      (params.walletTags ?? []).filter((t) => t !== solMemoString),
    );
    const otherMemoOf = (tx: ParsedTransactionWithMeta) =>
      tx.transaction.message.instructions
        .filter(
          (ix: ParsedInstruction | PartiallyDecodedInstruction) =>
            ix.programId.toString() === MEMO_PROGRAM_ID && "parsed" in ix,
        )
        .map((ix) => String((ix as ParsedInstruction).parsed))
        .find((m) => otherMemos.has(m));

    try {
      const account = mint ? await historyAccount(pubKey, mint) : pubKey;
      const sigs = await sigsOf(account);

      // Deposits carrying another session's memo: that session's money, kept
      // out of this fallback's figure by attribution. The listing shows each
      // signature's memo text for free, so only candidates are fetched.
      if (otherMemos.size > 0) {
        reserved = [];
        let memoFetches = 0;
        for (const sig of sigs) {
          if (sig.err || !sig.blockTime) continue;
          if (![...otherMemos].some((m) => couldCarryMemo(sig.memo, m))) continue;
          if (memoFetches >= MAX_MEMO_FETCHES) break;
          memoFetches++;
          const tx = await txOf(sig.signature);
          if (!tx?.meta || tx.meta.err) continue;
          const memo = otherMemoOf(tx);
          const credit = netCredit(tx, pubKey, account, mint);
          if (!memo || credit <= 0) continue;
          reserved.push({
            amount: credit,
            at: new Date(sig.blockTime * 1000),
            tag: memo,
            txHash: sig.signature,
          });
        }
      }

      // Find one that actually credits us: the merchant self-custodies, so the
      // newest signature is routinely their own outgoing sweep. Never one
      // carrying another session's memo.
      let fetches = 0;
      for (const sig of sigs) {
        if (sig.err) continue;
        if (fetches >= MAX_TX_FETCHES) break;
        fetches++;
        const tx = await txOf(sig.signature);
        if (!tx?.meta || tx.meta.err) continue;
        if (netCredit(tx, pubKey, account, mint) <= 0) continue;
        if (otherMemos.size > 0 && otherMemoOf(tx)) continue;

        txHash = sig.signature;
        if (sig.confirmationStatus === "finalized") {
          confirmations = Math.max(confirmations, 1);
        }
        break;
      }
    } catch (err) {
      // Non-fatal: the deposit and amount are known and confirmationsFromAge
      // still settles the session. Only the explorer link is lost.
      console.warn(
        `[sol] txHash resolution failed for ${address}:`,
        err instanceof Error ? err.message : err,
      );
    }

    return {
      detected: true,
      receivedAmount: received,
      currentBalance,
      txHash,
      confirmations,
      status: confirmations >= 1 ? status : "confirming",
      reserved,
    };
  },

  /**
   * Sum what transactions carrying `memo` credited us, so shared-wallet
   * sessions never claim each other's deposits. Errors propagate — "could not
   * read" must not read as "no memoed deposit exists".
   */
  async _checkPaymentWithMemo(
    pubKey: PublicKey,
    expectedAmount: number,
    memo: string,
    mint?: PublicKey,
    confirmedFrom?: number,
  ): Promise<PaymentCheckResult> {
    let totalReceived = 0;
    let txHash: string | undefined;
    let confirmations = 0;

    const account = mint ? await historyAccount(pubKey, mint) : pubKey;
    const sigs = await getSignatures(account);

    let fetches = 0;
    for (const sig of sigs) {
      if (sig.err) continue;
      // Free rejection from the signature listing — no round trip.
      if (!couldCarryMemo(sig.memo, memo)) continue;
      if (fetches >= MAX_TX_FETCHES) break;
      fetches++;

      const tx = await getParsedTx(sig.signature);
      if (!tx?.meta || tx.meta.err) continue;

      // Re-checked against the instruction: a substring match on the listing's
      // memo field is not proof of an exact memo.
      const hasMemo = tx.transaction.message.instructions.some(
        (ix: ParsedInstruction | PartiallyDecodedInstruction) =>
          ix.programId.toString() === MEMO_PROGRAM_ID &&
          "parsed" in ix &&
          ix.parsed === memo,
      );
      if (!hasMemo) continue;

      const delta = netCredit(tx, pubKey, account, mint);
      if (delta <= 0) continue;

      totalReceived += delta;
      if (!txHash) {
        txHash = sig.signature;
        confirmations = sig.confirmationStatus === "finalized" ? 1 : 0;
      }
    }

    if (totalReceived <= 0) return { detected: false };

    const status = classifyAmount(totalReceived, expectedAmount, confirmedFrom);

    return {
      detected: true,
      receivedAmount: totalReceived,
      exclusive: true,
      txHash,
      confirmations,
      status: confirmations >= 1 ? status : "confirming",
    };
  },
} as ChainAdapter & {
  _checkPaymentWithMemo: (
    pubKey: PublicKey,
    expectedAmount: number,
    memo: string,
    mint?: PublicKey,
    confirmedFrom?: number,
  ) => Promise<PaymentCheckResult>;
};
