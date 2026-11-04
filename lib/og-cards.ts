// What each public page's share image (opengraph-image.tsx, rendered by
// lib/og.tsx) says. Pure, so the copy is testable and the routes stay one
// line each. Copy only claims what the code does, and never a fee figure:
// rates come from the billed schedule, which isn't readable at build time.

export interface OgCard {
  /** Small label above the title: the page or section. */
  eyebrow: string;
  title: string;
  subtitle?: string;
}

export const OG_CARDS = {
  home: {
    eyebrow: "Paid straight to your wallet",
    title: "Decentralized Crypto Payment Gateway",
    subtitle: "Non-custodial, white label and open source. Buyers pay your own wallet, with no KYC and nobody to block you.",
  },
  about: {
    eyebrow: "About",
    title: "A payment gateway that never holds your money",
    subtitle: "Buyers pay your own wallet. We only read public blockchain data.",
  },
  blog: {
    eyebrow: "Blog",
    title: "Notes on non-custodial crypto payments",
    subtitle: "Guides, product updates and what we learn running a gateway.",
  },
  checkoutDemo: {
    eyebrow: "Checkout demo",
    title: "See your brand on the checkout",
    subtitle: "Add your name, logo and colour, then pay as a buyer would. Runs in your browser.",
  },
  checkout: {
    eyebrow: "Secure checkout",
    title: "Pay with crypto, straight to the merchant's wallet",
    subtitle: "Non-custodial: nobody holds your payment in between.",
  },
  contact: {
    eyebrow: "Contact",
    title: "Talk to the Crypteo team",
    subtitle: "Questions about payments, the API or your account.",
  },
  docs: {
    eyebrow: "Developers",
    title: "Integration guide and API reference",
    subtitle: "Create a payment, redirect to the hosted checkout, verify the signed webhook.",
  },
  faq: {
    eyebrow: "FAQ",
    title: "Questions about non-custodial payments",
    subtitle: "Wallets, fees, supported coins, confirmation times and integration.",
  },
  playground: {
    eyebrow: "API playground",
    title: "Try the payments API in your browser",
    subtitle: "Create a test session and walk through the hosted checkout.",
  },
  pricing: {
    eyebrow: "Pricing",
    title: "Volume-based pricing, nothing up front",
    subtitle: "No setup fee, no monthly minimum and no payout fees, because there are no payouts.",
  },
  privacy: {
    eyebrow: "Legal",
    title: "Privacy Policy",
    subtitle: "What we collect, why, and how to delete it. We never have your keys or funds.",
  },
  whiteLabel: {
    eyebrow: "White label",
    title: "White label crypto payment gateway",
    subtitle: "Your logo, colour, support contact and domain on a checkout that pays your own wallet.",
  },
  openSource: {
    eyebrow: "Open source · MIT",
    title: "Open source crypto payment gateway",
    subtitle: "Self-host it with Docker Compose and pay no platform fee, or let us run it for you.",
  },
  api: {
    eyebrow: "Developers",
    title: "Crypto payment gateway API",
    subtitle: "One request creates a payment. Signed webhooks tell your server when it's paid.",
  },
  decentralised: {
    eyebrow: "No KYC",
    title: "Decentralised crypto payment gateway",
    subtitle: "Buyers pay your wallet directly. No account review, no balance anyone can freeze.",
  },
  development: {
    eyebrow: "Development and integration",
    title: "Crypto payments in your product, without building a gateway",
    subtitle: "Hosted checkout, chain watching and webhooks, wired into your order flow.",
  },
  wordpress: {
    eyebrow: "WooCommerce plugin",
    title: "WordPress crypto payment gateway",
    subtitle: "A WooCommerce plugin that takes crypto straight to your wallet, on your own checkout page.",
  },
  paymentLinks: {
    eyebrow: "Payment links",
    title: "Crypto payment links",
    subtitle: "Set a price, share the link, and get paid straight to your own wallet.",
  },
  telegram: {
    eyebrow: "Telegram bot",
    title: "Crypto payment gateway for Telegram bot",
    subtitle: "Add the bot to a group or channel and post pay buttons in seconds.",
  },
  terms: {
    eyebrow: "Legal",
    title: "Terms of Service",
    subtitle: "The terms for using a gateway that never holds your funds.",
  },
} as const satisfies Record<string, OgCard>;

export type OgCardKey = keyof typeof OG_CARDS;

/** Cut at a word boundary with an ellipsis, so a long blog title can't overflow the card. */
export function clipText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** Title size in px: long titles step down so they stay within three lines. */
export function titleSize(title: string): number {
  if (title.length <= 32) return 76;
  if (title.length <= 56) return 64;
  return 52;
}
