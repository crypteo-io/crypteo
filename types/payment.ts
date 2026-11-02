import type { PaymentStatus } from "@/lib/chains/interface";

export type { PaymentStatus };

export interface Wallet {
  id: string;
  createdAt: Date | string;
  merchantId: string;
  chain: string;
  token: string;
  address: string;
  isActive: boolean;
  xrpTag?: string | null;
}

export interface Payment {
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  merchantId: string;
  chain: string | null;
  token: string | null;
  expectedAmount: number;
  walletAddress: string | null;
  balanceSnapshot: number;
  status: PaymentStatus;
  xrpDestinationTag?: string | null;
  senderAddress?: string | null;
  solMemoString?: string | null;
  txHash: string | null;
  receivedAmount: number | null;
  confirmations: number;
  nextPollAt: Date | string | null;
  pollInterval: number;
  lastPolledAt: Date | string | null;
  pollPhase: string;
  externalId: string | null;
  webhookUrl: string | null;
  webhookSentAt: Date | string | null;
  webhookAttempts: number;
  metadata: Record<string, unknown> | null;
  customerEmail: string | null;
  emailSentAt: Date | string | null;
  expiresAt: Date | string;
  isTest?: boolean;
  paymentLink?: { title: string; description?: string | null } | null;
  availableWallets?: AvailableWallet[];
}

export interface AvailableWallet {
  chain: string;
  token: string;
  address: string;
  xrpTag?: string | null;
}

export interface WebhookLog {
  id: string;
  createdAt: Date | string;
  paymentId: string;
  url: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  response: string | null;
  attempt: number;
  success: boolean;
}

export interface EmailLog {
  id: string;
  createdAt: Date | string;
  paymentId: string;
  type: string;
  recipient: string;
  subject: string;
  sentAt: Date | string | null;
  error: string | null;
}

export interface Merchant {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  isActive?: boolean;
  createdAt?: Date | string;
  emailVerified?: Date | string | null;
  defaultWebhookUrl?: string | null;
  webhookSecret?: string | null;
  underpaidThreshold?: number;
}

export interface ApiKey {
  id: string;
  createdAt: Date | string;
  merchantId: string;
  keyPrefix: string;
  label: string | null;
  lastUsedAt: Date | string | null;
  isActive: boolean;
  isTest?: boolean;
  /** Where this key's payments send webhooks; null = the default endpoint. */
  webhookEndpointId?: string | null;
}

export interface PaymentLink {
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  merchantId: string;
  title: string;
  description: string | null;
  amount: number;
  walletAddress: string | null;
  chain: string | null;
  token: string | null;
  /** Its custom webhook URL, if any (else an endpoint or the default). */
  webhookUrl?: string | null;
  /** Display name of where its webhooks go; null = the default endpoint. */
  webhookDestination?: string | null;
  isActive: boolean;
  expiresAt: Date | string | null;
  paymentLimit: number | null;
  paymentsCount: number;
  url: string;
}
