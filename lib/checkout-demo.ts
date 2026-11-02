import type { AvailableWallet } from "@/types/payment";
import { normalizeBrandColor } from "./branding";

// The public checkout demo (app/checkout-demo) lives entirely in the visitor's
// browser: nothing here is sent anywhere, and what it restores from
// localStorage is treated as untrusted input.

export const DEMO_STORAGE_KEY = "crypteo-checkout-demo";

/** Above this a cropped logo stays in memory only: localStorage holds ~5 MB per site. */
export const DEMO_LOGO_MAX_CHARS = 1_500_000;

export const DEMO_LIMITS = {
  name: 60,
  title: 80,
  description: 200,
  minAmountUsd: 1,
  maxAmountUsd: 100_000,
} as const;

export interface DemoSettings {
  name: string;
  title: string;
  description: string;
  amountUsd: number;
  /** "#rrggbb", or null for Crypteo's colours. */
  color: string | null;
  /** A data: URL of the cropped logo, or null. */
  logo: string | null;
}

export const DEFAULT_DEMO_SETTINGS: DemoSettings = {
  name: "Halden Coffee Roasters",
  title: "Espresso subscription",
  description: "Three months of fresh beans, shipped monthly.",
  amountUsd: 49,
  color: null,
  logo: null,
};

// Deliberately invalid addresses ("demo" isn't valid hex, base58 or bech32),
// so a wallet refuses a scanned demo QR code instead of sending funds.
export const DEMO_WALLETS: AvailableWallet[] = [
  { chain: "eth", token: "usdc", address: "0xDEMO000000000000000000000000000000000000" },
  { chain: "tron", token: "usdt", address: "TDEMOxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { chain: "sol", token: "usdc", address: "DEMOxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { chain: "btc", token: "btc", address: "bc1qdemoxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { chain: "eth", token: "eth", address: "0xDEMO000000000000000000000000000000000000" },
  { chain: "sol", token: "sol", address: "DEMOxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  { chain: "eth", token: "usdt", address: "0xDEMO000000000000000000000000000000000000" },
  { chain: "polygon", token: "usdc", address: "0xDEMO000000000000000000000000000000000000" },
  { chain: "bsc", token: "bnb", address: "0xDEMO000000000000000000000000000000000000" },
  { chain: "doge", token: "doge", address: "DDEMOxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
];

/** Round illustrative prices: the demo never asks a price source. */
export const DEMO_RATES: Record<string, number> = {
  usdc: 1,
  usdt: 1,
  btc: 100_000,
  eth: 4_000,
  sol: 200,
  bnb: 600,
  doge: 0.2,
};

/** Shown as the Solana memo, as a real session would get one. */
export const DEMO_SOL_MEMO = "demo-1042";

const LOGO_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A logo the demo may render: a base64 PNG/JPEG/WebP data URL within the size cap. */
export function isDemoLogo(value: unknown): value is string {
  return typeof value === "string" && value.length <= DEMO_LOGO_MAX_CHARS && LOGO_DATA_URL.test(value);
}

function text(value: unknown, max: number, fallback: string): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

/** Clamped to the demo's range, in cents; anything unreadable falls back. */
export function clampDemoAmount(value: unknown, fallback = DEFAULT_DEMO_SETTINGS.amountUsd): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(DEMO_LIMITS.maxAmountUsd, Math.max(DEMO_LIMITS.minAmountUsd, n));
  return Math.round(clamped * 100) / 100;
}

/** Settings restored from storage (or anything else): every field checked, defaults for the rest. */
export function parseDemoSettings(raw: unknown): DemoSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_DEMO_SETTINGS };
  const r: Record<string, unknown> = { ...raw };
  const d = DEFAULT_DEMO_SETTINGS;
  return {
    name: text(r.name, DEMO_LIMITS.name, d.name),
    title: text(r.title, DEMO_LIMITS.title, d.title),
    description: text(r.description, DEMO_LIMITS.description, d.description),
    amountUsd: clampDemoAmount(r.amountUsd),
    color: typeof r.color === "string" ? normalizeBrandColor(r.color) : null,
    logo: isDemoLogo(r.logo) ? r.logo : null,
  };
}
