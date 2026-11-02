import { DOC_SECTIONS } from "@/app/docs/content";
import type { FeeCopy } from "@/lib/billing/fee-schedule";
import { SOURCE_REPO_URL, WOOCOMMERCE_PLUGIN_PATH } from "@/lib/site-links";
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Code2,
  Container,
  Eye,
  FlaskConical,
  GitBranch,
  Globe,
  ImageIcon,
  KeyRound,
  LifeBuoy,
  Network,
  Palette,
  PiggyBank,
  Plug,
  Server,
  ShieldCheck,
  Store,
  Terminal,
  UserPlus,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";
import type { FaqItem } from "./faq";
import type { SolutionKey } from "./solution-links";

// Copy for the six solution pages (components/site/SolutionPage.tsx). Built
// per request because some of it prints the billed fee schedule. Copy only
// claims what the product does, and each page's FAQ asks its own questions.

export interface SolutionLinkTarget {
  label: string;
  href: string;
  /** A file download or another site, so not a client-side route. */
  plain?: boolean;
}

export interface SolutionFeature {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface SolutionStep {
  title: string;
  body: string;
}

export type SolutionSection =
  | { kind: "steps"; title: string; subtitle: string; steps: SolutionStep[] }
  | { kind: "hosting"; title: string; subtitle: string }
  | { kind: "code"; title: string; subtitle: string; examples: { label: string; code: string }[]; next: string[] }
  | { kind: "contrast"; title: string; subtitle: string; ours: string[]; theirsTitle: string; theirs: string[] };

export interface SolutionContent {
  eyebrow: string;
  subtitle: string;
  primary: SolutionLinkTarget;
  secondary: SolutionLinkTarget;
  featuresTitle: string;
  features: SolutionFeature[];
  sections: SolutionSection[];
  faq: FaqItem[];
  ctaTitle: string;
}

export interface HostingRow {
  label: string;
  selfHosted: string;
  hosted: string;
}

/** Self-hosted against hosted Crypteo: the home page and the open-source page. */
export function hostingComparison(fees: FeeCopy): HostingRow[] {
  return [
    {
      label: "Servers",
      selfHosted: "Yours. Docker Compose runs the app, worker, Postgres and nginx",
      hosted: "None to run. We operate and monitor it",
    },
    { label: "Updates", selfHosted: "You pull a release when you're ready", hosted: "Applied for you" },
    { label: "Platform fee", selfHosted: "None", hosted: `${fees.range} of monthly volume` },
    {
      label: "Branding",
      selfHosted: "Anything, it's your copy of the code",
      hosted: "Your logo, colour and support contact",
    },
    { label: "Custom domain", selfHosted: "The whole instance on your domain", hosted: "Payment links on your domain by CNAME" },
    { label: "Support", selfHosted: "The docs and GitHub issues", hosted: "Email the team" },
  ];
}

const CREATE_EXAMPLES = ["cURL", "Node.js", "Python", "PHP", "Response"];

/** The create-payment examples exactly as the API docs show them. */
function createPaymentExamples() {
  const section = DOC_SECTIONS.find((s) => s.id === "create");
  return (section?.examples ?? []).filter((e) => CREATE_EXAMPLES.includes(e.label));
}

export function solutionContent(key: SolutionKey, fees: FeeCopy): SolutionContent {
  switch (key) {
    case "whiteLabel":
      return {
        eyebrow: "White label",
        subtitle:
          "Put your brand on the whole payment flow: your logo and colour on the checkout, payment links on your own domain and your support contact where buyers look for help. The money still goes straight to your wallet.",
        primary: { label: "Start for free", href: "/register" },
        secondary: { label: "Try the checkout demo", href: "/checkout-demo" },
        featuresTitle: "Buyers see your shop, not ours",
        features: [
          {
            icon: Palette,
            title: "Your colour, kept readable",
            body: "Pick a brand colour and the checkout uses it for buttons, highlights and progress. Text is darkened where needed, so even a pale yellow stays legible.",
          },
          {
            icon: ImageIcon,
            title: "Your logo on top",
            body: "Upload a PNG, JPEG or WebP and crop it in the browser. It's re-encoded on our side before a buyer ever loads it.",
          },
          {
            icon: Globe,
            title: "Payment links on your domain",
            body: "Add a CNAME record such as pay.yourshop.com and your payment links open there instead of on crypteo.io.",
          },
          {
            icon: LifeBuoy,
            title: "Your support in the footer",
            body: "Show your own support contact at the foot of the checkout, and switch the small \"Powered by Crypteo\" line on or off.",
          },
        ],
        sections: [
          {
            kind: "steps",
            title: "Branded in an afternoon",
            subtitle: "Everything lives under Branding in the dashboard. Nothing to install.",
            steps: [
              { title: "Upload your logo and pick a colour", body: "The preview updates as you go, so you can see the checkout before a buyer does." },
              { title: "Add your support contact", body: "Buyers with a question reach you, not us. Decide whether the Powered by line shows." },
              { title: "Point a subdomain at Crypteo", body: "Create a CNAME record with your DNS provider and add the domain in the dashboard." },
              { title: "Share a link", body: "Send a payment link or create sessions through the API. Both open on your branded checkout." },
            ],
          },
        ],
        faq: [
          {
            q: "Will my buyers see the Crypteo name?",
            a: "Only if you want them to. The checkout carries your logo, colour and support contact, and the \"Powered by Crypteo\" footer is optional. Without a custom domain, payment links open on crypteo.io.",
          },
          {
            q: "Does white labelling cost extra?",
            a: "No. Branding, the custom domain and the footer settings come with every account, on every fee tier.",
          },
          {
            q: "Can I offer a crypto gateway to my own clients under my name?",
            a: "Yes, by self-hosting. Crypteo's source is MIT licensed, so you can run your own instance, rebrand it completely and onboard your clients as merchants on it.",
          },
        ],
        ctaTitle: "Put your brand on crypto checkout",
      };

    case "openSource":
      return {
        eyebrow: "Self hosted · MIT licence",
        subtitle:
          "Crypteo's source code is public. Run the whole gateway on your own server and pay no platform fee, or use the hosted service and let us run it. Either way, buyers pay your wallet directly.",
        primary: { label: "View the source", href: SOURCE_REPO_URL, plain: true },
        secondary: { label: "Use the hosted version", href: "/register" },
        featuresTitle: "The whole gateway, in your hands",
        features: [
          {
            icon: Code2,
            title: "The code that runs crypteo.io",
            body: "Hosted checkout, payment links, the REST API, signed webhooks, the chain watcher and both dashboards. Not a stripped-down community edition.",
          },
          {
            icon: Container,
            title: "One compose file",
            body: "Docker Compose starts Postgres, runs migrations, then the app, the worker and nginx, with nightly database backups and a monitor that emails you on outages.",
          },
          {
            icon: PiggyBank,
            title: "No platform fee",
            body: "A self-hosted instance pays Crypteo nothing. No percentage, no licence fee, no seat count.",
          },
          {
            icon: Server,
            title: "Your nodes, your database",
            body: "Point each chain at your own nodes or providers with an environment variable. Merchant data stays on your server.",
          },
        ],
        sections: [
          {
            kind: "hosting",
            title: "Self-hosted or hosted?",
            subtitle: "Same code, same checkout. The difference is who keeps the servers running.",
          },
          {
            kind: "steps",
            title: "What self-hosting takes",
            subtitle: "A small Linux server is enough to start.",
            steps: [
              { title: "Get the basics ready", body: "A server with Docker, a domain, an SMTP account for sign-in codes and alerts, and Cloudflare Turnstile keys for the public forms." },
              { title: "Clone and configure", body: "Clone the repository, copy .env.example to .env and fill in your secrets and addresses." },
              { title: "Start it", body: "Run docker compose up --build -d. Postgres comes up first, migrations run, then the app and worker start behind nginx." },
              { title: "Take a payment", body: "Sign in with the admin account the seed script creates, add your wallets and run a test checkout." },
            ],
          },
        ],
        faq: [
          {
            q: "What licence is Crypteo released under?",
            a: "MIT. You can use, modify, rebrand and run it commercially, as long as the licence notice stays with the code.",
          },
          {
            q: "Do self-hosted instances pay Crypteo anything?",
            a: `No. Fees apply only to the hosted service at crypteo.io, where they are ${fees.range} of monthly volume. On your own instance you pay for your server and nothing else.`,
          },
          {
            q: "Who keeps a self-hosted instance up to date?",
            a: "You do. Pull a new release and rebuild: the migrate step applies database changes before the app starts. On the hosted service, updates reach you without any work on your side.",
          },
        ],
        ctaTitle: "Run it yourself, or let us",
      };

    case "api":
      return {
        eyebrow: "Developers",
        subtitle:
          "Create a payment with one POST request, send the buyer to the hosted checkout and get a signed webhook when the money reaches your wallet. JSON over HTTPS, with test keys from day one.",
        primary: { label: "Read the API docs", href: "/docs" },
        secondary: { label: "Try the playground", href: "/playground" },
        featuresTitle: "Built to be boring to integrate",
        features: [
          {
            icon: Terminal,
            title: "A small REST API",
            body: "Create a payment, read it back, choose its network and manage payment links. A paid field tells you when to ship.",
          },
          {
            icon: Webhook,
            title: "Signed webhooks",
            body: "Every status change is posted to your endpoint with an HMAC-SHA256 signature of the raw body, and retried with backoff if your server is down.",
          },
          {
            icon: FlaskConical,
            title: "Test keys",
            body: "Keys starting with test_ create payments that never touch a chain. Play them out with the checkout's simulate button.",
          },
          {
            icon: Network,
            title: "Flexible or fixed amounts",
            body: "Send a USD price and let the buyer pick from your networks, or fix the chain, token and amount yourself.",
          },
        ],
        sections: [
          {
            kind: "code",
            title: "Create a payment",
            subtitle: "The request from the API docs: a $25 order where the buyer chooses the network. The response carries the checkout URL to send them to.",
            examples: createPaymentExamples(),
            next: [
              "Store payment.id next to your order.",
              "Redirect the buyer to checkoutUrl.",
              "Ship when a webhook, or GET /payments/{id}, says paid is true.",
            ],
          },
        ],
        faq: [
          {
            q: "How do I authenticate API requests?",
            a: "Send your key in an x-api-key header or as a Bearer token. Live keys start with crypt_ and test keys with test_. Only a hash of each key is stored, so keep a copy when you create it.",
          },
          {
            q: "Is the API rate limited?",
            a: "Yes, per minute: 120 requests per live key, 30 per test key and 60 per IP address for unauthenticated calls. Over the limit you get a 429 with a Retry-After header.",
          },
          {
            q: "What if my webhook endpoint is down?",
            a: "Crypteo retries after 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours. You can also resend from the dashboard, or read the payment with GET /payments/{id} at any time.",
          },
        ],
        ctaTitle: "Get an API key in a minute",
      };

    case "decentralised":
      return {
        eyebrow: "No KYC · non-custodial",
        subtitle:
          "Crypteo doesn't hold your money, doesn't approve your account and can't freeze a balance, because there isn't one. Buyers send crypto to your wallet and we read the public blockchain to confirm it.",
        primary: { label: "Sign up with an email", href: "/register" },
        secondary: { label: "See how it works", href: "/about" },
        featuresTitle: "Peer to peer, with a checkout on top",
        features: [
          {
            icon: UserPlus,
            title: "No KYC, no review queue",
            body: "No ID upload and no company documents. Confirm your email with a code and you can take a payment the same minute.",
          },
          {
            icon: Wallet,
            title: "Settles on-chain, to you",
            body: "The buyer's transaction lands at an address in your wallet. No pooled account, no payout schedule, nothing waiting to be released.",
          },
          {
            icon: KeyRound,
            title: "Keys stay with you",
            body: "We store public receiving addresses only. Never private keys or seed phrases, and there are no withdrawals to approve.",
          },
          {
            icon: Eye,
            title: "Checkable on any explorer",
            body: "Every payment Crypteo reports is a public transaction you can look up yourself.",
          },
        ],
        sections: [
          {
            kind: "contrast",
            title: "What changes without a middleman",
            subtitle: "Custodial gateways and card processors hold the money first. Crypteo never does.",
            theirsTitle: "Custodial gateways and processors",
            theirs: [
              "Hold your revenue until the next payout",
              "Can freeze an account after a risk review",
              "Ask for ID and business documents before you sell",
              "Keep reserves against chargebacks",
            ],
            ours: [
              "Funds reach your wallet with the transaction",
              "There's no balance on our side to freeze",
              "Email sign-up, no document checks",
              "On-chain payments can't be charged back",
            ],
          },
        ],
        faq: [
          {
            q: "Why doesn't Crypteo need to verify my identity?",
            a: "Because it never touches the money. There's no balance held in your name: payments go from the buyer's wallet to yours, and Crypteo only reads public blockchain data and sends you notifications.",
          },
          {
            q: "Do my buyers need an account?",
            a: "No. They open the checkout, pick a network and pay from any wallet or exchange account. There's nothing to sign up for.",
          },
          {
            q: "What happens to a payment if Crypteo is offline?",
            a: "The money still arrives, since it's an ordinary transfer to your address. Only the notice can be late: detection picks up again when the service is back, and a payment that lands after its checkout closed is recorded for review rather than dropped.",
          },
        ],
        ctaTitle: "Take crypto without asking permission",
      };

    case "development":
      return {
        eyebrow: "Development and integration",
        subtitle:
          "Adding crypto to a SaaS, a marketplace or a client's shop doesn't mean building a gateway. Crypteo handles the checkout, the chain watching and the notifications; you connect them to your order flow.",
        primary: { label: "Integration guide", href: "/docs" },
        secondary: { label: "Talk to us", href: "/contact" },
        featuresTitle: "The hard parts are already built",
        features: [
          {
            icon: Boxes,
            title: "Ten chains behind one API",
            body: "Reading each blockchain, matching deposits to orders, waiting for confirmations and handling underpayments is the gateway's job, not yours.",
          },
          {
            icon: Store,
            title: "Fits any stack",
            body: "Anything that can make an HTTPS request works. The docs carry examples in cURL, Node.js, Python and PHP.",
          },
          {
            icon: Users,
            title: "One account, many sites",
            body: "Give each site its own API key and webhook endpoint, so every store only hears about its own orders.",
          },
          {
            icon: GitBranch,
            title: "Fork it when you must",
            body: "The source is MIT licensed. If the hosted API doesn't cover a requirement, run your own instance and change it.",
          },
        ],
        sections: [
          {
            kind: "steps",
            title: "A typical integration",
            subtitle: "Five steps from a test key to live orders.",
            steps: [
              { title: "Create a test key", body: "Add your wallets in the dashboard and create a test_ key, so nothing real moves while you build." },
              { title: "Create a payment at checkout", body: "From your server, POST the order's price and your order id, and store the payment id it returns." },
              { title: "Send the buyer to the checkout", body: "Redirect to the checkoutUrl. The buyer picks a network and pays their own way." },
              { title: "Handle the webhook", body: "Verify the signature, read the payment back and mark the order paid when paid is true." },
              { title: "Go live", body: "Swap the test key for a live crypt_ key. Nothing else changes." },
            ],
          },
        ],
        faq: [
          {
            q: "Do I need to handle each blockchain separately?",
            a: "No. Every network goes through the same API and the same webhook. The payment's chain and token fields say which one the buyer used, and amounts are in that token's units once it's chosen.",
          },
          {
            q: "Can I build crypto payments for my clients?",
            a: "Yes. Each client can have their own account and wallets, so funds go straight to them, or you can host an instance for all of them from the open-source code.",
          },
          {
            q: "Can I show the payment details in my own interface?",
            a: "Yes. A payment created with a fixed chain and token returns its wallet address, amount and any XRP tag or Solana memo, so you can render them yourself and follow the status by webhook.",
          },
        ],
        ctaTitle: "Start building with a test key",
      };

    case "wordpress":
      return {
        eyebrow: "WooCommerce plugin",
        subtitle:
          "Add crypto to your WooCommerce store with the Crypteo plugin. Buyers choose crypto at checkout, pay your wallet directly, and the order is marked paid once the payment confirms.",
        primary: { label: "Download the plugin", href: WOOCOMMERCE_PLUGIN_PATH, plain: true },
        secondary: { label: "Create an account", href: "/register" },
        featuresTitle: "A payment method like any other",
        features: [
          {
            icon: Plug,
            title: "A standard WooCommerce gateway",
            body: "It appears in WooCommerce's payment settings next to your other methods and works with both the classic and the block checkout.",
          },
          {
            icon: ShieldCheck,
            title: "Orders change only on proof",
            body: "Each webhook's signature is checked, then the payment is read back from the Crypteo API before the order moves. A forged request completes nothing.",
          },
          {
            icon: Server,
            title: "Hosted or self-hosted",
            body: "Point the plugin at crypteo.io or at your own Crypteo instance. It's one setting.",
          },
        ],
        sections: [
          {
            kind: "steps",
            title: "Set up the plugin",
            subtitle: "About ten minutes, most of it copying two values.",
            steps: [
              { title: "Create your Crypteo account", body: "Sign up and add the wallet addresses you want to be paid into under Wallets." },
              { title: "Create an API key and a signing secret", body: "Create a live API key under API keys, and set a webhook signing secret in Settings, Webhooks." },
              { title: "Install the plugin", body: "Download the zip, then in WordPress go to Plugins, Add New, Upload Plugin. Choose the file, install and activate." },
              { title: "Connect it", body: "Open WooCommerce, Settings, Payments, enable Crypteo and paste the key and secret. Leave the address on crypteo.io or enter your own instance." },
              { title: "Place a test order", body: "Try it with a test key first: the checkout shows a simulate button, so you can watch the order turn paid without sending funds." },
            ],
          },
        ],
        faq: [
          {
            q: "Does the plugin support the WooCommerce block checkout?",
            a: "Yes. It works with the block-based checkout and the classic shortcode checkout.",
          },
          {
            q: "Which coins can my WooCommerce customers pay with?",
            a: "Any network you've added a wallet for, from Bitcoin and Ethereum to USDT on Tron. Shoppers choose crypto in your store, then pick the coin on the Crypteo checkout.",
          },
          {
            q: "What happens to the order if the buyer underpays?",
            a: "It stays pending. Crypteo marks the payment underpaid and the buyer can top up within the payment window. The order completes only when the payment counts as paid.",
          },
        ],
        ctaTitle: "Take crypto on your WooCommerce store",
      };
  }
}
