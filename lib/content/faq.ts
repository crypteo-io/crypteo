import type { FeeCopy } from "@/lib/billing/fee-schedule";
import { pricingTiers } from "./pricing";

// The site's questions: /faq shows them all, grouped; the home and pricing
// pages pick a few by key. Each answer says one thing, so no two repeat.

export type FaqItem = { q: string; a: string };
export type FaqGroup = { title: string; items: FaqItem[] };

// Fee figures come from the admin's fee schedule, so the answers are built
// per request (app/faq, app/pricing, app/page).
function feeAnswer(fees: FeeCopy): string {
  const tiers = pricingTiers(fees);
  const rates =
    tiers.length === 1
      ? `A flat ${tiers[0].rate} of your paid volume.`
      : `${tiers.map((t) => `${t.name} ${t.rate} (${t.volume.replace(" / month", " a month")})`).join(", ")}. Your month's paid volume sets the rate for that whole month.`;
  const cap = fees.monthlyCap ? ` Fees never exceed ${fees.monthlyCap} in a month.` : "";
  return `${rates}${cap} There's no setup fee and no withdrawal fee. ${fees.invoicing} Buyers pay their own network fee, as with any on-chain transfer, and a self-hosted instance pays no platform fee at all.`;
}

function faqEntries(fees: FeeCopy) {
  return {
    start: {
      q: "How do I start accepting crypto payments?",
      a: "Create an account, add the wallet addresses you want to be paid into, then share a payment link or create payment sessions through the API. Buyers pay on a hosted checkout and you get a webhook and an email when each payment confirms.",
    },
    approval: {
      q: "Do I need KYC or an account approval?",
      a: "No. There's no identity check and no approval queue: sign up with an email address, confirm it with a code and you can take payments straight away.",
    },
    wallet: {
      q: "Which wallet should I receive payments in?",
      a: "A self-custody wallet where you hold the keys, such as Base Wallet or Trust Wallet. Avoid exchange deposit addresses (Nexo, Binance, Coinbase and the like): exchanges screen incoming transfers, so they can hold a deposit or ask you to explain each payment, and some need their own XRP tag or Solana memo, which clashes with the one Crypteo assigns per checkout.",
    },
    paymentLinks: {
      q: "Can I take payments without a website?",
      a: "Yes, with payment links. Set a title and a USD price in the dashboard and share the link in a chat, an email or your social profile. Each visit opens its own checkout, and you can cap how many payments a link accepts or set when it expires.",
    },
    custody: {
      q: "Can Crypteo hold or freeze my money?",
      a: "No. Crypteo is non-custodial: you give us public receiving addresses, never private keys or seed phrases. Payments go from the buyer's wallet straight to yours, so there's no balance, payout schedule or reserve for anyone to lock.",
    },
    neverBlocked: {
      q: "What does \"never get blocked\" mean?",
      a: "Buyers pay a plain address in your own wallet, not a payment platform's pooled deposit address. To a buyer's exchange that looks like an ordinary withdrawal to a personal wallet, so there's no processor for it to refuse.",
    },
    payoutSafety: {
      q: "Could someone change my payout address?",
      a: "Not without access to your email. Signing in always needs a second factor, an emailed code or an authenticator app, and changing a receiving address asks for a fresh code too. Every wallet change also sends you an alert email.",
    },
    chains: {
      q: "Which blockchains and cryptocurrencies do you support?",
      a: "Bitcoin, Ethereum, Solana, XRP, BNB Smart Chain, Polygon, Tron, Dogecoin, Zcash (transparent addresses) and Cardano. USDC is accepted on Ethereum, Solana, BNB Smart Chain and Polygon; USDT on those plus Tron (TRC-20).",
    },
    speed: {
      q: "How fast are payments confirmed?",
      a: "A new checkout is checked on-chain every 15 seconds, less often as it ages, and confirmed once the network has the confirmations it needs: under a minute on Solana, XRP and BNB Smart Chain, a minute or two on Tron, Ethereum and Polygon, and three blocks (about 30 minutes) on Bitcoin. The funds sit in your wallet from the moment the transaction is mined.",
    },
    amounts: {
      q: "What happens if a buyer pays too little or too much?",
      a: "Each session compares what arrived with what was asked. An underpayment is marked underpaid and the buyer can top up within the payment window; an overpayment is marked overpaid. You choose how close a payment must be to count as paid.",
    },
    whiteLabel: {
      q: "Can I put my own brand on the checkout?",
      a: "Yes. Crypteo is white label: set your brand colour, upload your logo and show your own support contact in the checkout footer. The \"Powered by Crypteo\" line is optional, and branding comes with every tier.",
    },
    customDomain: {
      q: "Can payment links use my own domain?",
      a: "Yes. Add a CNAME record, for example pay.yourshop.com, and your payment links open on that address instead of crypteo.io.",
    },
    openSource: {
      q: "Is Crypteo open source? Can I self-host it?",
      a: "Yes. The full source is public under the MIT licence. Docker Compose runs the app, the worker, Postgres and nginx on your own server, and a self-hosted instance pays no platform fee; you look after the server and updates. The hosted service at crypteo.io is the same code without the upkeep.",
    },
    fees: { q: "What are the fees?", a: feeAnswer(fees) },
    integrate: {
      q: "How do I integrate Crypteo with my own site or app?",
      a: "Create payment sessions with the REST API and redirect buyers to the hosted checkout. Signed webhooks tell your backend when a payment is detected, confirmed, underpaid or expired, and test-mode API keys let you build the whole flow without moving real funds.",
    },
    plugins: {
      q: "Is there a WordPress or WooCommerce plugin?",
      a: "Yes, a WooCommerce plugin. It adds Crypteo as a payment method on both the classic and the block checkout, checks every webhook against the API before an order changes, and works with crypteo.io or your own instance. There's no Shopify app.",
    },
  } satisfies Record<string, FaqItem>;
}

type FaqKey = keyof ReturnType<typeof faqEntries>;

const GROUPS: { title: string; keys: FaqKey[] }[] = [
  { title: "Getting started", keys: ["start", "approval", "wallet", "paymentLinks"] },
  { title: "Funds and security", keys: ["custody", "payoutSafety", "neverBlocked"] },
  { title: "Payments", keys: ["chains", "speed", "amounts"] },
  { title: "White label and self-hosting", keys: ["whiteLabel", "customDomain", "openSource"] },
  { title: "Pricing and integration", keys: ["fees", "integrate", "plugins"] },
];

function pick(fees: FeeCopy, keys: FaqKey[]): FaqItem[] {
  const entries = faqEntries(fees);
  return keys.map((k) => entries[k]);
}

export function faqGroups(fees: FeeCopy): FaqGroup[] {
  return GROUPS.map((g) => ({ title: g.title, items: pick(fees, g.keys) }));
}

export const homeFaq = (fees: FeeCopy): FaqItem[] =>
  pick(fees, ["custody", "approval", "payoutSafety", "whiteLabel", "openSource", "fees"]);

export const pricingFaq = (fees: FeeCopy): FaqItem[] => pick(fees, ["fees", "openSource", "custody", "chains"]);
