export type PaymentStatus =
  | "pending"
  | "confirming"
  | "confirmed"
  | "underpaid"
  | "overpaid"
  | "expired"
  | "expired_received";

/**
 * Per-cycle memo of chain reads, shared by every session polled in one
 * scheduler cycle (see lib/chains/reads.ts).
 */
export type ReadCache = Map<string, Promise<unknown>>;

/**
 * A deposit carrying a per-session identifier (XRP destination tag, Solana
 * memo). It belongs to the session holding that identifier, so attribution
 * keeps it out of every other session's balance-diff figure.
 */
export interface TaggedTransfer {
  amount: number;
  at: Date;
  tag: string;
  txHash?: string;
}

export interface PaymentCheckResult {
  detected: boolean;
  receivedAmount?: number;
  txHash?: string;
  confirmations?: number;
  status?: PaymentStatus;
  /** Sender ("from") address of the attributed transaction, when resolvable. */
  fromAddress?: string;
  /**
   * Absolute on-chain balance observed this poll, for balance-diff detections
   * (EVM/BTC and the XRP/SOL no-tag fallback). Attribution uses this — not the
   * poller-relative `receivedAmount` — so every session sharing the wallet
   * computes the same per-candidate deltas and agrees on the winner.
   */
  currentBalance?: number;
  /**
   * True when `receivedAmount` is exclusively this session's, resolved by a
   * per-session identifier (XRP destination tag / Solana memo). Cross-session
   * attribution is then bypassed — no other session can match this deposit.
   */
  exclusive?: boolean;
  /**
   * Deposits seen carrying ANOTHER session's tag/memo (from walletTags). An
   * untagged fallback otherwise tied with — and could win — a deposit tagged
   * for someone else.
   */
  reserved?: TaggedTransfer[];
}

export interface CheckPaymentParams {
  address: string;
  expectedAmount: number;
  token: string;
  balanceSnapshot: number;
  createdAt: Date;
  xrpDestinationTag?: string;
  solMemoString?: string;
  /**
   * Transaction hash already attributed to this session on a prior poll.
   * When set, adapters look the tx up directly (age-independent) to recount
   * confirmations instead of re-scanning a narrow window of recent blocks.
   */
  existingTxHash?: string;
  /**
   * Amount already credited to this session on a prior poll. Re-confirmation
   * re-reports this instead of a fresh balance diff: once a deposit is
   * attributed, the merchant is free to sweep the wallet, which drives the
   * diff negative and would otherwise look like "no payment".
   */
  creditedAmount?: number;
  /**
   * When this session first observed its deposit. Lets an adapter derive a
   * confirmation count from elapsed time when no tx hash could be resolved
   * (see confirmationsFromAge in ./config).
   */
  firstDetectedAt?: Date;
  /** Merchant's confirmed-from ratio, threaded into classifyAmount. */
  confirmedFrom?: number;
  /**
   * Tags/memos of the wallet's OTHER sessions from the last day, live or not:
   * a deposit carrying one is that session's money, never this fallback's.
   */
  walletTags?: string[];
  /** Per-cycle read cache (lib/chains/reads.ts); absent = read fresh. */
  reads?: ReadCache;
  /**
   * The session's status before this poll. Lets hash-tracking adapters stop
   * re-reporting a short credited amount once the session has settled as
   * underpaid, so a top-up (or the real payment after a dust send) can be
   * seen instead of the stale credit being re-classified forever.
   */
  currentStatus?: string;
  /** What balanceSnapshot measures (Payment.snapshotBasis); null = legacy. */
  snapshotBasis?: string | null;
}

export interface ChainAdapter {
  chain: string;
  supportedTokens: string[];
  /**
   * Recorded on the session (Payment.snapshotBasis) when getBalanceSnapshot
   * is read, so a later change of basis never compares a new reading against
   * an old snapshot in different units. Unset = legacy basis (null).
   */
  snapshotBasis?: string;
  getBalanceSnapshot(address: string, token?: string): Promise<number>;
  checkPayment(params: CheckPaymentParams): Promise<PaymentCheckResult>;
}
