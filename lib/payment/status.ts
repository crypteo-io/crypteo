// What a payment status means for the merchant's order. Sent as `paid` in the
// webhook payload and the public API so integrations don't have to rebuild the
// status table: a merchant site that fulfilled only "confirmed" left an
// overpaid order (12.7 USDT received for 12) pending (2026-10-10).

/** The buyer paid at least the full amount: fulfil the order. */
export const PAID_STATUSES = ["confirmed", "overpaid"] as const;

export function isPaidStatus(status: string): boolean {
  return (PAID_STATUSES as readonly string[]).includes(status);
}
