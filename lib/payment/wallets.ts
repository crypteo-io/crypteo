import { isValidAddress } from "../chains/address";

/**
 * Why a merchant's saved wallet can't receive `chain` payments, or null. The
 * one rule for binding a payment (resolveAssignment) and for pinning a payment
 * link to a network, so a link can't be pinned to a wallet checkout refuses.
 */
export function walletRefusal(
  wallet: { address: string; isActive: boolean } | null,
  chain: string,
): string | null {
  const network = chain.toUpperCase();
  if (!wallet || !wallet.isActive) return `No active ${network} wallet is set up for this token`;
  if (!isValidAddress(chain.toLowerCase(), wallet.address)) {
    return `The saved ${network} wallet address is not valid on this network`;
  }
  return null;
}

export interface OfferableWallet {
  chain: string;
  token: string;
  address: string;
  xrpTag: string | null;
}

/**
 * The networks a buyer may pick from a merchant's active wallets: normalised,
 * one per chain/token, and never a wallet whose address isn't valid on its
 * chain. Validation at save time (app/api/wallets) doesn't cover wallets saved
 * before it existed: a Solana address stored as an XRP wallet in April was
 * still offered at checkout in October, and buyers were asked to send XRP to it.
 */
export function offerableWallets(
  rows: readonly { chain: string; token: string; address: string; xrpTag?: string | null }[],
): OfferableWallet[] {
  const seen = new Set<string>();
  const out: OfferableWallet[] = [];
  for (const w of rows) {
    const chain = w.chain.toLowerCase();
    const token = w.token.toLowerCase();
    const key = `${chain}-${token}`;
    if (seen.has(key) || !isValidAddress(chain, w.address)) continue;
    seen.add(key);
    out.push({ chain, token, address: w.address, xrpTag: w.xrpTag || null });
  }
  return out;
}

/** Tokens a platform fee invoice can be paid in. */
export const FEE_PAYMENT_TOKENS = ["usdt", "usdc"] as const;
const FEE_TOKENS: readonly string[] = FEE_PAYMENT_TOKENS;

/**
 * The networks offered on one session. A platform fee checkout
 * (feeForStatementId) is paid in stablecoins only: invoices are in USD and a
 * volatile token would settle a different figure than the one billed.
 */
export function sessionWallets<T extends OfferableWallet>(
  wallets: readonly T[],
  session: { feeForStatementId: string | null },
): T[] {
  return session.feeForStatementId
    ? wallets.filter((w) => FEE_TOKENS.includes(w.token))
    : [...wallets];
}

/** Why this token can't be chosen on this session, or null. */
export function sessionTokenRefusal(
  session: { feeForStatementId: string | null },
  token: string,
): string | null {
  return session.feeForStatementId && !FEE_TOKENS.includes(token.toLowerCase())
    ? "Platform fees are paid in USDT or USDC"
    : null;
}
