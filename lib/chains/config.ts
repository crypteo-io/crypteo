/** An ERC-20/BEP-20 token on one EVM chain. */
export interface EvmTokenConfig {
  contract: string;
  // Kept beside the contract address so adding a token can't silently inherit
  // the wrong scale. Decimals are a per-chain fact, not a per-token one: USDT
  // is 6 on Ethereum and Polygon but 18 on BSC — reading a balance at the wrong
  // decimals misreports the amount by twelve orders of magnitude.
  decimals: number;
}

export interface EvmChainConfig {
  /** EIP-155 chain id, pinned on the provider and put in EIP-681 URIs. */
  chainId: number;
  /** Native gas token symbol (lowercase), e.g. "eth", "bnb", "pol". */
  nativeToken: string;
  tokens: Record<string, EvmTokenConfig>;
  /**
   * Blocks the native-transfer hash walk reads back from the head. Native
   * transfers emit no log, so this is one full-body getBlock per block —
   * sized to cover roughly one early poll interval (15s) on each chain.
   */
  nativeScanBlocks: number;
  /**
   * Cap on the token-transfer log walk, in blocks (one getLogs call per 100).
   * A round-trip budget rather than a time window: a day on Ethereum would be
   * 190k blocks — 1,900 calls per poll — on BSC.
   */
  maxLogLookbackBlocks: number;
  /**
   * Fastest realistic block time, for converting time into blocks to SEARCH.
   * The opposite rounding from CHAIN_BLOCK_TIME_MS (rounded up so age-derived
   * confirmations err low): here a too-slow figure undersizes the walk and
   * misses the deposit.
   */
  searchBlockTimeMs: number;
}

// Contract addresses and decimals verified on-chain 2026-10-12 (decimals()).
export const EVM_CHAINS: Record<string, EvmChainConfig> = {
  eth: {
    chainId: 1,
    nativeToken: "eth",
    tokens: {
      usdc: {
        contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals: 6,
      },
      usdt: {
        contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals: 6,
      },
    },
    nativeScanBlocks: 50,
    maxLogLookbackBlocks: 7_200, // ~1 day
    searchBlockTimeMs: 12_000,
  },
  bsc: {
    chainId: 56,
    nativeToken: "bnb",
    tokens: {
      // Binance-Peg BEP-20 tokens: 18 decimals, unlike their Ethereum originals.
      usdt: {
        contract: "0x55d398326f99059fF775485246999027B3197955",
        decimals: 18,
      },
      usdc: {
        contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        decimals: 18,
      },
    },
    nativeScanBlocks: 40,
    maxLogLookbackBlocks: 2_400, // ~18 min
    searchBlockTimeMs: 450, // measured 2026-10-12
  },
  polygon: {
    chainId: 137,
    nativeToken: "pol",
    tokens: {
      // Circle-native USDC, not the bridged USDC.e (0x2791…4174).
      usdc: {
        contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        decimals: 6,
      },
      usdt: {
        contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        decimals: 6,
      },
    },
    nativeScanBlocks: 20,
    maxLogLookbackBlocks: 1_800, // ~45 min
    searchBlockTimeMs: 1_500, // measured 2026-10-12
  },
};

// TRC-20 contracts on Tron. USDC is deliberately absent: Circle discontinued
// it on Tron in 2024, and a session no wallet can pay is worse than none.
export const TRON_TOKEN_CONTRACTS: Record<string, EvmTokenConfig> = {
  usdt: { contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
};

// SPL mint addresses for the tokens we accept on Solana. A transfer of one of
// these does NOT move the recipient's native SOL balance — it moves the balance
// of an associated token account — so the Solana adapter must read the token
// account, not `getBalance`.
export const SOL_TOKEN_MINTS: Record<string, string> = {
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdt: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

// Time per unit of confirmation, per chain. Used to convert "how long have we
// been observing this deposit" into a confirmation count when the adapter could
// not resolve a transaction hash (see confirmationsFromAge).
//
// This is the time per CONFIRMATIONS_REQUIRED unit, not necessarily raw block
// time. Solana is the case that matters: its slot time is ~400ms, but its
// requirement of 1 confirmation means *finalized*, which takes ~13s (32 slots).
// Using the slot time here would let a deposit be treated as final within a
// second of being seen, quietly weakening the guarantee the adapter's own
// `confirmationStatus === "finalized"` check exists to provide.
export const CHAIN_BLOCK_TIME_MS: Record<string, number> = {
  eth: 12_000,
  btc: 600_000,
  sol: 13_000,
  xrp: 4_000,
  // Measured 2026-10-12 at 0.45s (BSC) and 1.5s (Polygon); rounded UP, since a
  // longer block time yields fewer age-derived confirmations — the safe side.
  bsc: 750,
  polygon: 2_000,
  tron: 3_000,
  doge: 60_000,
  zec: 75_000,
  // Cardano: 1s slots, ~1 block per 20 slots on average.
  ada: 20_000,
};

export const CONFIRMATIONS_REQUIRED: Record<string, number> = {
  eth: 12,
  usdc: 12,
  usdt: 12,
  btc: 3,
  sol: 1,
  xrp: 1,
  // BSC has fast finality within a few blocks; 30 blocks is ~15s.
  bsc: 30,
  // Polygon PoS finalises via Heimdall milestones in seconds; 64 blocks
  // (~2 min) stays well clear of any reorg seen since milestones shipped.
  polygon: 64,
  // A Tron block is irreversible ("solidified") after 19 confirmations.
  tron: 19,
  doge: 6,
  zec: 10,
  ada: 15,
};

/**
 * Confirmations needed before a deposit on `chain` is final.
 *
 * Confirmations are a property of the chain, not the token — the usdc/usdt
 * entries above exist only because CONFIRMATIONS_REQUIRED predates multi-token
 * chains, and they encode Ethereum's requirement. Looking up by token alone
 * therefore demands 12 confirmations for Solana USDC, whose chain requirement
 * is 1. Chain wins; token is the fallback for anything not chain-keyed.
 */
export function requiredConfirmations(chain: string, token?: string): number {
  return (
    CONFIRMATIONS_REQUIRED[chain.toLowerCase()] ??
    CONFIRMATIONS_REQUIRED[(token || "").toLowerCase()] ??
    12
  );
}

// Default status thresholds. confirmed_from is the fallback floor used when a
// merchant hasn't set their own (Merchant.underpaidThreshold). overpaid_above
// stays global.
export const PAYMENT_TOLERANCE = {
  confirmed_from: 0.99,
  overpaid_above: 1.001,
};

// Bounds a merchant-configured underpaid threshold must fall within.
export const UNDERPAID_THRESHOLD_MIN = 0.95;
export const UNDERPAID_THRESHOLD_MAX = 1.0;

export type AmountStatus = "overpaid" | "confirmed" | "underpaid";

// Significant digits a balance survives with. A double holds ~15.9, and the
// Prisma → Postgres write of a Float keeps 16, so digits past this are noise.
const BALANCE_SIGNIFICANT_DIGITS = 14;

/**
 * `current - snapshot`, with float noise discarded.
 *
 * Balances are floats and the stored snapshot loses its 17th significant digit
 * on write: an ETH balance of 13095911247036125 wei reads back as
 * 0.013095911247036124 but is stored as 0.01309591124703612. Re-reading the
 * UNCHANGED balance then yields a "deposit" of 3.47e-18 ETH — less than one
 * wei — which passed `received > 0` and flagged unpaid sessions as underpaid.
 * Anything below the precision of the larger operand is zero; the rest is
 * rounded to that precision so credited amounts aren't stored as
 * 0.002267000000000001.
 */
export function balanceDelta(current: number, snapshot: number): number {
  const magnitude = Math.max(Math.abs(current), Math.abs(snapshot));
  if (magnitude === 0) return 0;
  const places = Math.min(
    100,
    Math.max(
      0,
      BALANCE_SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(magnitude)),
    ),
  );
  const delta = Number((current - snapshot).toFixed(places));
  return delta === 0 ? 0 : delta; // Normalise -0.
}

/**
 * Whether a hash-tracking adapter should stop re-reporting `credited` and
 * re-detect from the balance instead.
 *
 * Re-reporting the credited amount is what keeps a swept wallet's session
 * alive while it confirms, and it must stay that way for "confirming": on a
 * shared wallet a confirming session sent back through attribution can defer
 * to a newer session's deposit forever and time out. But once a session has
 * SETTLED as underpaid, re-reporting the short credit freezes it there — a
 * top-up, or the real payment after a dust send credited first, is never
 * counted. Settled-underpaid sessions go back through attribution, where a
 * deferral just leaves them underpaid.
 */
export function shouldRedetectUnderpaid(
  currentStatus: string | undefined,
  credited: number,
  expected: number,
  confirmedFrom?: number,
): boolean {
  return (
    currentStatus === "underpaid" &&
    classifyAmount(credited, expected, confirmedFrom) === "underpaid"
  );
}

/**
 * Classify a received amount against the expected amount. `confirmedFrom` is the
 * received/expected ratio at or above which a payment is fully paid; below it,
 * underpaid. Defaults to the global floor; callers pass the merchant's own.
 */
export function classifyAmount(
  received: number,
  expected: number,
  confirmedFrom: number = PAYMENT_TOLERANCE.confirmed_from,
): AmountStatus {
  // Non-positive expected = malformed invoice; never let it auto-confirm.
  if (!(expected > 0)) return "underpaid";
  const floor =
    confirmedFrom > 0 && confirmedFrom <= PAYMENT_TOLERANCE.overpaid_above
      ? confirmedFrom
      : PAYMENT_TOLERANCE.confirmed_from;
  const ratio = received / expected;
  if (ratio >= PAYMENT_TOLERANCE.overpaid_above) return "overpaid";
  if (ratio >= floor) return "confirmed";
  return "underpaid";
}

/**
 * Confirmations implied by how long a deposit has been continuously observed.
 *
 * Balance-diff detection can see the money without ever resolving a tx hash —
 * an ETH deposit that scrolls out of the adapter's recent-block scan window is
 * the common case. Without this, `confirmations` stays 0 forever and the
 * session is pinned in "confirming" for the rest of its life.
 *
 * A balance delta read at the chain head and still present N ms later has by
 * definition survived N / blockTime blocks, so age is a sound (deliberately
 * conservative) lower bound on the real confirmation count.
 */
export function confirmationsFromAge(
  chain: string,
  firstDetectedAt: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!firstDetectedAt) return 0;
  const blockTime = CHAIN_BLOCK_TIME_MS[chain.toLowerCase()];
  if (!blockTime) return 0;
  const elapsed = now.getTime() - firstDetectedAt.getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / blockTime);
}
