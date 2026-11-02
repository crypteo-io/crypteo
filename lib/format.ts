// Amount formatting shared by the checkout UI, the dashboard and the email
// templates. Amounts are stored as Float, and interpolating a float directly
// prints exponent notation for small values (`${5e-7}` → "5e-7") and float
// noise for others — neither of which a buyer can paste into a wallet, and
// "5e-7 BTC" in a merchant email reads like a bug.

/**
 * Display precision per token. Matches (or, for ETH, deliberately undercuts)
 * the token's on-chain precision: 18 ETH decimals would be unreadable and
 * sessions are priced to 6 anyway, so 8 loses nothing real.
 */
const DISPLAY_DECIMALS: Record<string, number> = {
  btc: 8,
  eth: 8,
  sol: 9,
  xrp: 6,
  trx: 6,
  bnb: 8,
  pol: 8,
  doge: 8,
  zec: 8,
  ada: 6,
  usdc: 6,
  usdt: 6,
  usd: 2,
};

const DEFAULT_DECIMALS = 8;

function displayDecimals(token?: string | null): number {
  return DISPLAY_DECIMALS[(token || "").toLowerCase()] ?? DEFAULT_DECIMALS;
}

/**
 * Plain decimal string: never exponent notation, no grouping separators (so it
 * is safe to copy into a wallet or embed in a payment URI), trailing zeros
 * trimmed, at most `maxDecimals` fraction digits.
 *
 * Intl formats from the shortest round-trip representation of the double, so
 * 0.1 prints as "0.1" rather than toFixed(20)'s "0.10000000000000000555".
 */
export function toPlainDecimal(amount: number, maxDecimals: number): string {
  if (!Number.isFinite(amount)) return "0";
  const out = new Intl.NumberFormat("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Math.min(20, maxDecimals)),
  }).format(amount);
  // Normalise "-0" (a tiny negative rounded away) to "0".
  return out === "-0" ? "0" : out;
}

/**
 * Human-readable amount for `token`, e.g. formatAmount(5e-7, "btc") →
 * "0.0000005". A non-zero amount too small for the token's display precision
 * renders as "<0.00000001" rather than "0", so a real (if tiny) shortfall is
 * never reported as nothing.
 */
export function formatAmount(
  amount: number | null | undefined,
  token?: string | null,
  decimals?: number,
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "0";
  }
  const places = decimals ?? displayDecimals(token);
  const out = toPlainDecimal(amount, places);
  if (amount !== 0 && /^-?0$/.test(out)) {
    const smallest = toPlainDecimal(10 ** -places, places);
    return amount < 0 ? `>-${smallest}` : `<${smallest}`;
  }
  return out;
}

/**
 * USD → token amount at `priceUsd`, rounded to 6 dp (the precision sessions
 * are priced to). Pure and client-safe, so the checkout can preview the
 * amount it will be asked for without importing the server-side pricing code.
 */
export function estimateTokenAmount(usd: number, priceUsd: number): number {
  return Number((usd / priceUsd).toFixed(6));
}
