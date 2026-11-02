// The six solution pages: names, paths and the one-line blurbs the navbar's
// Solutions menu and the footer show. Page copy is in ./solutions.ts.

export const SOLUTION_KEYS = ["whiteLabel", "openSource", "api", "decentralised", "development", "wordpress"] as const;
export type SolutionKey = (typeof SOLUTION_KEYS)[number];

export interface SolutionLink {
  key: SolutionKey;
  /** The page's full name, also its meta title. Bracketed text is a qualifier, left out of the slug and the heading. */
  title: string;
  /** Short name for menus. */
  label: string;
  blurb: string;
  /** Meta description, under 160 characters. */
  description: string;
  path: string;
}

/** "Open Source Crypto Payment Gateway (Self Hosted)" → "open-source-crypto-payment-gateway". */
export function solutionSlug(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The page heading: the title without its bracketed qualifier. */
export function solutionHeading(title: string): string {
  return title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

const LINKS: Record<SolutionKey, Omit<SolutionLink, "key" | "path">> = {
  whiteLabel: {
    title: "White Label Crypto Payment Gateway",
    label: "White label",
    blurb: "Your logo, colours and domain on every checkout",
    description:
      "White label crypto payment gateway: your logo, colour, support contact and custom domain on a non-custodial checkout. Payments go to your own wallet.",
  },
  openSource: {
    title: "Open Source Crypto Payment Gateway (Self Hosted)",
    label: "Open source and self-hosted",
    blurb: "Run Crypteo on your own server with no platform fee",
    description:
      "Open source crypto payment gateway under the MIT licence. Self-host it with Docker and pay no platform fee, or use the hosted service.",
  },
  api: {
    title: "Crypto Payment Gateway API",
    label: "Payments API",
    blurb: "One REST call per payment, signed webhooks back",
    description:
      "Crypto payment gateway API: create a payment in one request, redirect to the hosted checkout, get signed webhooks. Non-custodial, with test keys.",
  },
  decentralised: {
    title: "Decentralised Crypto Payment Gateway (No KYC)",
    label: "Decentralised, no KYC",
    blurb: "Buyers pay your wallet, nobody in between",
    description:
      "Decentralised crypto payment gateway with no KYC: buyers pay your own wallet, nobody holds your funds, and sign-up takes an email address.",
  },
  development: {
    title: "Crypto Payment Gateway Development and Integration",
    label: "Development and integration",
    blurb: "Build crypto checkout into your product",
    description:
      "Crypto payment gateway development without building one: integrate Crypteo's API, hosted checkout and webhooks into your SaaS, store or marketplace.",
  },
  wordpress: {
    title: "WordPress Crypto Payment Gateway",
    label: "WordPress and WooCommerce",
    blurb: "A WooCommerce plugin for your store's checkout",
    description:
      "WordPress crypto payment gateway: the Crypteo WooCommerce plugin takes BTC, ETH, USDT and more straight to your wallet, on classic or block checkout.",
  },
};

export const solutionLink = (key: SolutionKey): SolutionLink => ({
  key,
  ...LINKS[key],
  path: `/${solutionSlug(LINKS[key].title)}`,
});

export const SOLUTIONS: SolutionLink[] = SOLUTION_KEYS.map(solutionLink);
