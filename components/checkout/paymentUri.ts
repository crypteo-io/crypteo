// Wallet-scannable payment URIs for the checkout QR code.
//
// A bare `${address}?amount=…` has no scheme, so wallets either reject it or —
// worse — treat the whole string as the address. Each chain has its own
// standard, and each one wants the amount in a specific unit.
//
// lib/chains/config.ts has no imports (no Prisma, no Node APIs), so it is safe
// to pull into this client-side module.
import { EVM_CHAINS, SOL_TOKEN_MINTS } from "@/lib/chains/config";
import { toPlainDecimal } from "@/lib/format";
import { parseEther, parseUnits } from "ethers";

export interface PaymentUriInput {
  chain: string | null | undefined;
  token: string | null | undefined;
  address: string | null | undefined;
  amount: number | null | undefined;
  solMemo?: string | null;
}

// Decimal string at the token's full on-chain precision. The amount is a
// float, so it is first cut to the 15 significant digits a double actually
// holds: written out at 18 decimals, 0.1 + 0.2 would otherwise ask the buyer
// for 300000000000000040 wei. Going through a string (never `amount * 1e18`)
// keeps float error out of the integer base-unit value.
function decimalString(amount: number, decimals: number): string {
  return toPlainDecimal(Number(amount.toPrecision(15)), Math.min(decimals, 20));
}

/**
 * The URI to encode in the "With Amount" QR. Falls back to the bare address
 * whenever a correct URI can't be built — an unknown token, a missing amount,
 * or a chain with no URI scheme wallets agree on: XRP (its destination tag is
 * shown separately on the page instead), Tron, and Cardano (CIP-13 exists but
 * few wallets read it, and one that misreads it is worse than none).
 */
export function buildPaymentUri({
  chain,
  token,
  address,
  amount,
  solMemo,
}: PaymentUriInput): string {
  const addr = address || "";
  const c = (chain || "").toLowerCase();
  const t = (token || "").toLowerCase();
  if (!addr || !(amount && amount > 0)) return addr;

  try {
    if (c === "btc" && t === "btc") {
      // BIP21: amount in BTC as a decimal.
      return `bitcoin:${addr}?amount=${decimalString(amount, 8)}`;
    }

    if (c === "doge" && t === "doge") {
      // BIP21 under Dogecoin's scheme.
      return `dogecoin:${addr}?amount=${decimalString(amount, 8)}`;
    }

    if (c === "zec" && t === "zec") {
      // ZIP-321: amount in ZEC as a decimal.
      return `zcash:${addr}?amount=${decimalString(amount, 8)}`;
    }

    const evm = EVM_CHAINS[c];
    if (evm) {
      // EIP-681 always names the chain id. Without it a wallet connected to
      // another EVM network could send the payment there, where the worker
      // never looks — and BSC/Polygon wallets default to Ethereum.
      if (t === evm.nativeToken) {
        // EIP-681: `value` is an integer in wei (or the native token's
        // 18-decimal equivalent).
        const wei = parseEther(decimalString(amount, 18));
        return `ethereum:${addr}@${evm.chainId}?value=${wei.toString()}`;
      }
      const tokenConfig = evm.tokens[t];
      if (!tokenConfig) return addr;
      const { contract, decimals } = tokenConfig;
      // EIP-681 ERC-20 transfer: target is the token contract, the recipient
      // and amount (in base units) are the call's arguments.
      const units = parseUnits(decimalString(amount, decimals), decimals);
      return `ethereum:${contract}@${evm.chainId}/transfer?address=${addr}&uint256=${units.toString()}`;
    }

    if (c === "sol") {
      // Solana Pay: amount in the token's UI units, SPL mint when not SOL.
      const params = new URLSearchParams();
      if (t === "sol") {
        params.set("amount", decimalString(amount, 9));
      } else {
        const mint = SOL_TOKEN_MINTS[t];
        if (!mint) return addr;
        params.set("amount", decimalString(amount, 6));
        params.set("spl-token", mint);
      }
      if (solMemo) params.set("memo", solMemo);
      return `solana:${addr}?${params.toString()}`;
    }
  } catch {
    // parseUnits rejects malformed input; a plain address is still a correct
    // (if less convenient) QR, so degrade to it rather than break the page.
    return addr;
  }

  return addr;
}
