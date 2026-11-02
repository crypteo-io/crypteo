import { Prisma } from "@prisma/client";
import { ORIGINAL_USD_KEY, metadataObject } from "./assign";

// What a session is worth in USD: the price it was created at
// (metadata.originalUsdAmount), else its amount when the token is a USD
// stablecoin. A session priced in a volatile token has no recorded USD value;
// callers either count it as excluded (dashboards) or price it (billing).
// The SQL twin below must stay in step with the function (usd-value.test.ts).

export const USD_STABLECOINS = ["usdc", "usdt"] as const;

export function knownUsdValue(p: {
  token: string | null;
  expectedAmount: number;
  metadata: Prisma.JsonValue | null;
}): number | null {
  const recorded = metadataObject(p.metadata)[ORIGINAL_USD_KEY];
  if (typeof recorded === "number" && Number.isFinite(recorded) && recorded > 0) {
    return recorded;
  }
  if ((USD_STABLECOINS as readonly string[]).includes((p.token ?? "").toLowerCase())) {
    return p.expectedAmount;
  }
  return null;
}

/**
 * The same rule as knownUsdValue, as a SQL expression over a "Payment" row
 * aliased `p`; NULL where the value is unknown. Only a JSON number counts as a
 * recorded price, so a string in metadata never reaches the float cast. The
 * key is ORIGINAL_USD_KEY, spelled out (asserted in usd-value.test.ts).
 */
// CASE (not AND) guards the cast: Postgres doesn't promise AND's order.
export const KNOWN_USD_SQL = Prisma.sql`COALESCE(
  CASE WHEN jsonb_typeof(p."metadata"->'originalUsdAmount') = 'number'
    THEN NULLIF(GREATEST((p."metadata"->>'originalUsdAmount')::float8, 0), 0) END,
  CASE WHEN lower(p."token") IN ('usdc', 'usdt') THEN p."expectedAmount" END
)`;
