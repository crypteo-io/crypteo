import { prisma } from "../db";
import { AllEndpointsFailedError } from "./rpc";

/** Address/config faults the caller must fix. Retrying cannot help. */
const PERMANENT_PATTERNS = [
  "account malformed",
  "actmalformed",
  "invalid address",
  "invalid public key",
  "non-base58",
  "checksum",
  "no erc-20 configuration",
];

export interface SnapshotErrorResponse {
  status: 400 | 503;
  error: string;
  /** Seconds; set only for 503 so clients back off instead of hammering. */
  retryAfter?: number;
}

/**
 * Classify a getBalanceSnapshot failure.
 *
 * The distinction is the caller's, not ours: a malformed wallet address is
 * permanent and theirs to fix, while an unreachable chain is transient and
 * ours. Returning 400 for both told integrators their request was invalid when
 * our RPC was down, and 400 is not retried.
 */
export function classifySnapshotError(err: unknown): SnapshotErrorResponse {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (PERMANENT_PATTERNS.some((p) => msg.includes(p))) {
    return {
      status: 400,
      error: "Invalid wallet address configured for this network.",
    };
  }

  if (err instanceof AllEndpointsFailedError) {
    return {
      status: 503,
      error:
        "Unable to reach the blockchain network right now, so this payment could not be opened. No funds have been requested. Please retry shortly.",
      retryAfter: 30,
    };
  }

  return {
    status: 503,
    error:
      "Failed to connect to the blockchain network. Please try again shortly.",
    retryAfter: 15,
  };
}

/** Headers for a classified snapshot failure. */
export function snapshotErrorHeaders(
  res: SnapshotErrorResponse,
): Record<string, string> {
  return res.retryAfter ? { "Retry-After": String(res.retryAfter) } : {};
}

/**
 * Record a failed balance read for operators.
 *
 * The buyer only ever sees the generic message from classifySnapshotError —
 * endpoint URLs and provider errors are internal. This is where the cause goes
 * so the monitor can alert on it and someone can act.
 *
 * Fire-and-forget and never throws: alerting must not be able to fail a request
 * that is already failing.
 */
export function recordChainReadFailure(opts: {
  chain: string;
  token: string;
  context: string;
  error: unknown;
}): void {
  const message = (
    opts.error instanceof Error ? opts.error.message : String(opts.error)
  ).slice(0, 1000);

  void prisma.chainReadFailure
    .create({
      data: {
        chain: opts.chain,
        token: opts.token,
        context: opts.context,
        message,
      },
    })
    .catch((err) => {
      console.error("[chains] Failed to record chain read failure:", err);
    });
}
