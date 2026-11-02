/**
 * Per-session on-chain identifiers for shared receiving wallets.
 *
 * A merchant registers one address per chain/token, so concurrent sessions all
 * watch the same wallet. An XRP destination tag or Solana memo lets a deposit
 * be attributed to exactly one session instead of being arbitrated by amount
 * proximity (lib/payment/match.ts).
 *
 * These are best-effort: a buyer withdrawing from a custodial exchange often
 * cannot attach a tag or memo, so the adapters treat a missing identifier as a
 * reason to fall back to balance-diff detection, never as "no payment".
 */
export interface SessionIdentifiers {
  xrpDestinationTag: string | null;
  solMemoString: string | null;
}

export function generateSessionIdentifiers(chain: string): SessionIdentifiers {
  const normalized = chain.toLowerCase();

  if (normalized === "xrp") {
    // Unique uint32 destination tag (XRPL rejects 0 and values above 2^32-1).
    return {
      xrpDestinationTag: String(Math.floor(Math.random() * 2147483647) + 1),
      solMemoString: null,
    };
  }

  if (normalized === "sol") {
    // Short hex memo — long enough to be collision-free across live sessions,
    // short enough that a buyer can retype it.
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return {
      xrpDestinationTag: null,
      solMemoString: Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    };
  }

  return { xrpDestinationTag: null, solMemoString: null };
}
