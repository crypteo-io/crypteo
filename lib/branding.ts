import type { CSSProperties } from "react";
import { z } from "zod";

// Pure and client-safe: the checkout (server) and the branding page's live
// preview (client) derive the palette from the same function.

export const BRAND_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** Largest logo file the upload route accepts. The cropper re-encodes to well under it. */
export const LOGO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Crypteo's own checkout colours, used when a merchant hasn't picked one. */
export const DEFAULT_CHECKOUT_PALETTE = {
  accent: "#1c2f41",
  accentDeep: "#060f16",
  ink: "#135ca4",
  onAccent: "#ffffff",
} as const;

export type CheckoutPalette = { [K in keyof typeof DEFAULT_CHECKOUT_PALETTE]: string };

/** The checkout footer's contact when a merchant hasn't set their own. */
export const PLATFORM_SUPPORT_EMAIL = "support@crypteo.io";
export const DEFAULT_SUPPORT_LINK_LABEL = "Contact us";

export interface CheckoutContact {
  label: string;
  url: string;
}

/** What the checkout pages need to brand themselves. Never the logo bytes. */
export interface CheckoutBranding {
  name: string | null;
  logoUrl: string | null;
  color: string | null;
  /** The merchant's support address, or null for Crypteo's. */
  supportEmail: string | null;
  contact: CheckoutContact | null;
  poweredBy: boolean;
}

/**
 * The branding API's footer fields. The link opens from the buyer's checkout,
 * so only https: a javascript: or data: URL would run on our origin.
 */
export const checkoutFooterSchema = z.object({
  supportEmail: z.string().trim().toLowerCase().email().max(254).nullable(),
  supportLinkLabel: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => v || null),
  supportLinkUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => URL.canParse(u) && new URL(u).protocol === "https:", "Use an https:// link")
    .nullable(),
  showPoweredBy: z.boolean(),
});

// WCAG 2 contrast for text on the checkout's white panels.
const MIN_TEXT_CONTRAST = 4.5;
const DARK_TEXT = "#060f16";
const WHITE = "#ffffff";

/** "#ABC", "abc123", " #AbC123 " → "#aabbcc" / "#abc123"; anything else null. */
export function normalizeBrandColor(input: string): string | null {
  let hex = input.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return BRAND_COLOR_PATTERN.test(hex) ? hex : null;
}

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix toward black by `amount` (0–1). */
function darken(hex: string, amount: number): string {
  return toHex(toRgb(hex).map((c) => c * (1 - amount)) as [number, number, number]);
}

/**
 * The checkout palette for a merchant colour. Buttons and selected states are
 * filled with the colour as picked; their label is white or near-black,
 * whichever reads better. Text, icons, borders and progress bars on white use
 * `ink`: the colour darkened just enough to reach 4.5:1, so a pale yellow
 * brand still gives legible links instead of yellow-on-white.
 */
export function checkoutPalette(color: string | null): CheckoutPalette {
  const hex = color ? normalizeBrandColor(color) : null;
  if (!hex) return { ...DEFAULT_CHECKOUT_PALETTE };

  let ink = hex;
  for (let step = 1; contrastRatio(ink, WHITE) < MIN_TEXT_CONTRAST && step <= 20; step++) {
    ink = darken(hex, step * 0.05);
  }

  return {
    accent: hex,
    accentDeep: darken(hex, 0.18),
    ink,
    onAccent: contrastRatio(WHITE, hex) >= contrastRatio(DARK_TEXT, hex) ? WHITE : DARK_TEXT,
  };
}

/** The CSS variables behind the checkout's `ck` colour tokens (app/globals.css). */
export function checkoutPaletteStyle(color: string | null): CSSProperties {
  const p = checkoutPalette(color);
  return {
    "--ck-accent": p.accent,
    "--ck-accent-deep": p.accentDeep,
    "--ck-ink": p.ink,
    "--ck-on": p.onAccent,
  } as CSSProperties;
}

export function brandLogoUrl(logoId: string): string {
  return `/api/brand-logo/${logoId}`;
}

/** Prisma `select` for a merchant's checkout branding (the logo's id, not its bytes). */
export const BRANDING_MERCHANT_SELECT = {
  name: true,
  brandColor: true,
  logo: { select: { id: true } },
  supportEmail: true,
  supportLinkLabel: true,
  supportLinkUrl: true,
  showPoweredBy: true,
} as const;

export function toCheckoutBranding(merchant: {
  name: string;
  brandColor: string | null;
  logo: { id: string } | null;
  supportEmail: string | null;
  supportLinkLabel: string | null;
  supportLinkUrl: string | null;
  showPoweredBy: boolean;
}): CheckoutBranding {
  return {
    name: merchant.name,
    logoUrl: merchant.logo ? brandLogoUrl(merchant.logo.id) : null,
    color: merchant.brandColor,
    supportEmail: merchant.supportEmail,
    contact: merchant.supportLinkUrl
      ? { label: merchant.supportLinkLabel || DEFAULT_SUPPORT_LINK_LABEL, url: merchant.supportLinkUrl }
      : null,
    poweredBy: merchant.showPoweredBy,
  };
}
