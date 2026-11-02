import type { AvailableWallet, PaymentStatus } from "@/types/payment";

// The hosted checkout is public — anyone holding the session id can load it —
// so its props carry only what the buyer UI renders. Passing the whole Payment
// row serialised the merchant's webhookUrl, metadata, customerEmail,
// externalId, balanceSnapshot and poll internals into the page HTML.

/** Fields the pay step (PayClient) renders. Mirrors GET /api/payments/[id]. */
export interface CheckoutPayment {
  id: string;
  status: PaymentStatus;
  chain: string | null;
  token: string | null;
  walletAddress: string | null;
  expectedAmount: number;
  receivedAmount: number | null;
  confirmations: number;
  txHash: string | null;
  xrpDestinationTag?: string | null;
  solMemoString?: string | null;
  expiresAt: Date | string;
  isTest?: boolean;
  paymentLink?: { title: string; description?: string | null } | null;
  /** The merchant's pages to return to (public API successUrl/cancelUrl). */
  successUrl?: string | null;
  cancelUrl?: string | null;
}

/** Fields the chain/token selection step (CheckoutClient) renders. */
export interface CheckoutSelectPayment {
  id: string;
  /** USD amount the session is priced from. */
  expectedAmount: number;
  expiresAt: Date | string;
  isTest?: boolean;
  paymentLink?: { title: string; description?: string | null } | null;
  availableWallets: AvailableWallet[];
  exchangeRates: Record<string, number>;
  cancelUrl?: string | null;
}

/**
 * Prisma `select` for CheckoutPayment. Kept beside the type so the two can't
 * drift apart.
 */
export const CHECKOUT_PAYMENT_SELECT = {
  id: true,
  status: true,
  chain: true,
  token: true,
  walletAddress: true,
  expectedAmount: true,
  receivedAmount: true,
  confirmations: true,
  txHash: true,
  xrpDestinationTag: true,
  solMemoString: true,
  expiresAt: true,
  isTest: true,
  successUrl: true,
  cancelUrl: true,
  paymentLink: { select: { title: true, description: true } },
} as const;

/**
 * Statuses where money has been seen on-chain. A session in one of these must
 * stay reachable after expiry — the buyer needs to see what happened to their
 * funds, not a 404.
 */
export const FUNDS_SEEN_STATUSES: readonly string[] = [
  "confirming",
  "confirmed",
  "underpaid",
  "overpaid",
  "expired_received",
];
