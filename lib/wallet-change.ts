// When saving a receiving address needs the account's second factor.
//
// A slot (chain + token) that has never held an address takes its first one
// without a code: that is setting up, and the owner is emailed either way.
// Replacing an address or XRP tag needs a code, and so does filling a slot
// that once held one, or a delete followed by an add would skip it. One
// accepted code covers further changes for CHANGE_WINDOW_MS, unless the
// account's sessions were revoked or its password changed since.

export const CHANGE_WINDOW_MS = 15 * 60 * 1000;

export function walletSlot(chain: string, token: string): string {
  return `${chain}:${token}`;
}

export interface WalletChangeState {
  /** The address or XRP tag differs from what the slot holds now. */
  changed: boolean;
  /** The slot holds an address now. */
  occupied: boolean;
  /** The slot is listed in Merchant.walletSlotsUsed. */
  usedBefore: boolean;
  verifiedAt: Date | null;
  revokedAt: Date | null;
  passwordChangedAt: Date | null;
  now: number;
}

export function walletWindowOpen(s: WalletChangeState): boolean {
  if (!s.verifiedAt) return false;
  const at = s.verifiedAt.getTime();
  if (s.revokedAt && s.revokedAt.getTime() >= at) return false;
  if (s.passwordChangedAt && s.passwordChangedAt.getTime() >= at) return false;
  return s.now - at < CHANGE_WINDOW_MS && at <= s.now;
}

export function walletCodeRequired(s: WalletChangeState): boolean {
  if (!s.changed) return false;
  if (!s.occupied && !s.usedBefore) return false;
  return !walletWindowOpen(s);
}
