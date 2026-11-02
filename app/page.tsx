import { COINS } from "@/components/home/coins";
import HeroPreview from "@/components/home/HeroPreview";
import { Accordion } from "@/components/site/Accordion";
import { ButtonAnchor, ButtonLink, FrostedButtonLink } from "@/components/site/Button";
import { CopyButton } from "@/components/site/CopyButton";
import { FeatureCard } from "@/components/site/FeatureCard";
import { HostingComparison } from "@/components/site/HostingComparison";
import { SectionHeading, SkyBackdrop } from "@/components/site/PageHero";
import { JsonLd } from "@/components/site/JsonLd";
import SiteShell from "@/components/site/SiteShell";
import { feeCopy, type FeeCopy } from "@/lib/billing/fee-schedule";
import { getPublicFeeSchedule } from "@/lib/billing/settings";
import { homeFaq } from "@/lib/content/faq";
import { pricingTiers } from "@/lib/content/pricing";
import { solutionLink } from "@/lib/content/solution-links";
import { hostingComparison } from "@/lib/content/solutions";
import { organizationJsonLd, pageMetadata, websiteJsonLd } from "@/lib/seo";
import { SOURCE_REPO_URL } from "@/lib/site-links";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  ChevronRight,
  Code2,
  GitBranch,
  Globe,
  KeyRound,
  Link2,
  UserPlus,
  Wallet,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

// Rendered per request: the fee figures come from the admin's fee settings.
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Decentralized Crypto Payment Gateway | Crypteo",
  description:
    "Decentralized, non-custodial crypto payment gateway: buyers pay your own wallet. White label, open source, with an API, no KYC and low fees.",
  path: "/",
  absoluteTitle: true,
});

export default async function HomePage() {
  const fees = feeCopy(await getPublicFeeSchedule());
  return (
    <SiteShell>
      <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
      <Hero />
      <CoinMarquee />
      <NeverBlocked />
      <HowItWorks />
      <OpenSourceWhiteLabel fees={fees} />
      <Developers />
      <PricingTeaser fees={fees} />
      <HomeFaq fees={fees} />
    </SiteShell>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden pt-32 pb-16 md:pt-40 md:pb-20 lg:pt-50">
      <SkyBackdrop src="/bg/section-bg-2.webp" />
      <div className="absolute inset-x-[-10%] bottom-[-14%] -z-10 h-100 bg-white blur-2xl" />
      <div className="container-site">
        <div className="text-center">
          <span className="eyebrow">
            <Zap size={16} className="fill-yellow-400 text-yellow-400" />
            Paid straight to your wallet
          </span>
          <h1 className="mx-auto mt-4 mb-5 max-w-5xl text-[44px] leading-[1.08] tracking-[-0.03em] md:text-[76px] lg:text-[88px]">
            Decentralised payment gateway
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-default-950 md:text-xl">
            Accept Bitcoin and stablecoins with buyers paying your own wallet directly. Non-custodial,
            white label and open source, with no KYC and nobody in the middle to block you.
          </p>
          <div className="inline-flex flex-wrap items-center justify-center gap-4 md:gap-8">
            <FrostedButtonLink href="/register">Start accepting crypto</FrostedButtonLink>
            <Link href="/checkout-demo" className="group inline-flex items-center gap-2 font-medium text-default-950">
              Try the checkout
              <ChevronRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
        <HeroPreview />
      </div>
    </section>
  );
}

function CoinMarquee() {
  const strip = (
    <div className="infinite-scroll flex shrink-0 gap-14 pr-14">
      {COINS.map((c) => (
        <div key={c.symbol} className="flex items-center gap-2.5 whitespace-nowrap">
          <Image src={c.icon} alt="" width={28} height={28} className="rounded-full" />
          <span className="font-heading text-lg font-semibold text-default-900">{c.symbol}</span>
          <span className="text-default-500">{c.name}</span>
        </div>
      ))}
    </div>
  );
  return (
    <section className="py-16 md:py-20">
      <p className="container-site mb-10 text-center text-xl font-medium text-default-950">
        Accept multiple assets and networks
      </p>
      <div className="relative flex overflow-hidden" aria-label="Supported assets">
        <div className="absolute inset-y-0 left-0 z-10 hidden w-28 bg-linear-to-r from-white to-transparent lg:block" />
        {strip}
        <div aria-hidden="true" className="flex">
          {strip}
        </div>
        <div className="absolute inset-y-0 right-0 z-10 hidden w-28 bg-linear-to-l from-white to-transparent lg:block" />
      </div>
    </section>
  );
}

function NeverBlocked() {
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site">
        <div className="mb-10 flex flex-col justify-between gap-6 md:mb-12 md:flex-row md:items-end">
          <SectionHeading
            align="left"
            title="Never get blocked"
            subtitle="Card processors and custodial gateways sit between you and your money, and any one of them can say no. Crypteo isn't in that path."
          />
          <ButtonLink href="/faq" variant="primary" size="sm" className="shrink-0 self-start md:self-auto">
            How it works
          </ButtonLink>
        </div>

        <div className="grid gap-6 md:grid-cols-2 md:gap-7.5">
          <FeatureCard
            icon={BadgeCheck}
            title="Kill KYC once"
            body="No merchant KYC, no account review and no documents to upload. Sign up, add your wallet and sell: every payment goes straight to you, never through a balance someone else controls."
          />
          <FeatureCard
            icon={Globe}
            title="White label, down to the domain"
            body="Your logo, colour and support contact on the checkout, and payment links on your own domain. Want the whole stack under your name? Self-host the open-source code."
          />
        </div>
        <div className="mt-6 grid gap-6 md:mt-7.5 md:grid-cols-3 md:gap-7.5">
          <FeatureCard
            icon={KeyRound}
            title="Non-custodial by design"
            body="We only ever see public addresses. No private keys, no seed phrases, no withdrawals to approve."
          />
          <FeatureCard
            icon={Zap}
            title="Watched from the first second"
            body="A new checkout is checked on-chain every 15 seconds and confirmed once the network has the confirmations it needs."
          />
          <FeatureCard
            icon={BellRing}
            title="Webhooks and email alerts"
            body="Every status change, whether detected, confirmed, underpaid or expired, reaches your backend as a signed webhook."
          />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: UserPlus,
      title: "1. Create your account",
      body: "Sign up with an email address and confirm it with a code. That's the whole onboarding.",
    },
    {
      icon: Wallet,
      title: "2. Add your wallets",
      body: "Paste the receiving addresses from your own self-custody wallet for each network you want to accept.",
    },
    {
      icon: Link2,
      title: "3. Get paid",
      body: "Share a payment link or create a session through the API. Buyers pay on a hosted checkout page.",
    },
  ];
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site">
        <SectionHeading title="Live in five minutes" className="mb-12 md:mb-16" />
        <div className="grid gap-10 md:grid-cols-3 md:gap-7.5">
          {steps.map(({ icon: Icon, title, body }) => (
            <div key={title} className="mx-auto max-w-xs text-center">
              <span className="icon-tile mb-5 size-14">
                <Icon size={24} />
              </span>
              <h3 className="mb-3 text-xl">{title}</h3>
              <p className="text-default-600">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OpenSourceWhiteLabel({ fees }: { fees: FeeCopy }) {
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site">
        <div className="relative isolate overflow-hidden rounded-[28px] bg-primary px-5 py-12 md:px-12 md:py-16">
          <div aria-hidden className="absolute -top-48 -right-40 -z-10 size-130 rounded-full bg-sky/50 blur-3xl" />
          <div aria-hidden className="absolute -bottom-56 -left-40 -z-10 size-110 rounded-full bg-sky/25 blur-3xl" />
          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
            <div>
              <span className="inline-flex items-center gap-2.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white">
                <GitBranch size={16} />
                Open source · MIT licence
              </span>
              <h2 className="mt-5 mb-5 text-[32px] leading-[1.15] text-white md:text-[44px]">
                Your brand on it, your server under it
              </h2>
              <p className="text-lg font-normal text-white/80">
                Crypteo is white label and fully open source. Run it on your own server with Docker
                Compose and pay no platform fee, or use the hosted version and leave the upkeep to us.
                Either way buyers see your logo, your colour and your domain.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <ButtonLink href={solutionLink("openSource").path} variant="white" icon={<ArrowRight size={18} />}>
                  Self-hosting explained
                </ButtonLink>
                <ButtonAnchor href={SOURCE_REPO_URL} variant="ghost" className="px-2 text-white">
                  View the source
                </ButtonAnchor>
              </div>
            </div>
            <HostingComparison rows={hostingComparison(fees)} />
          </div>
        </div>
      </div>
    </section>
  );
}

// The curl example shown (highlighted) in Developers, as copied.
const CREATE_PAYMENT_CURL = `curl -X POST https://crypteo.io/api/public/v1/payments \\
  -H "x-api-key: crypt_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 49.00,
    "externalId": "order_1042",
    "webhookUrl": "https://shop.example/hooks"
  }'`;

function Developers() {
  return (
    <section className="relative isolate overflow-hidden py-20 md:py-28">
      <div className="absolute inset-0 -z-10 bg-linear-to-b from-white via-[#dbe9f7] to-white" />
      {/* min-w-0: a grid item won't shrink below its content, so the code
          block's long curl line widened the column past a phone's screen. */}
      <div className="container-site grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <span className="icon-tile mb-6 size-12">
            <Code2 size={22} />
          </span>
          <h2 className="mb-5 text-[32px] leading-[1.15] md:text-[44px]">One API call to take a payment</h2>
          <p className="mb-6 text-lg text-default-600">
            The crypto payment gateway API is small on purpose: create a payment session, redirect the
            buyer to the hosted checkout and listen for the signed webhook. Test-mode keys let you build
            the whole flow without moving real funds.
          </p>
          <div className="flex flex-wrap gap-4">
            <ButtonLink href="/docs" icon={<ArrowRight size={18} />}>
              API reference
            </ButtonLink>
            <ButtonLink href="/playground" variant="white">
              Try the playground
            </ButtonLink>
          </div>
        </div>
        <div className="frame relative min-w-0">
          <CopyButton text={CREATE_PAYMENT_CURL} label="Copy the curl example" className="absolute top-4.5 right-4.5 z-10" />
          <pre className="overflow-x-auto rounded-2xl bg-default-950 p-6 pt-14 font-mono text-[13px] leading-relaxed text-default-200">
            <code>
              <span className="text-sky-soft">curl</span> -X POST https://crypteo.io/api/public/v1/payments \{"\n"}
              {"  "}-H <span className="text-emerald-300">&quot;x-api-key: crypt_YOUR_KEY&quot;</span> \{"\n"}
              {"  "}-H <span className="text-emerald-300">&quot;Content-Type: application/json&quot;</span> \{"\n"}
              {"  "}-d <span className="text-emerald-300">{"'{"}</span>{"\n"}
              {"    "}<span className="text-amber-200">&quot;amount&quot;</span>: 49.00,{"\n"}
              {"    "}<span className="text-amber-200">&quot;externalId&quot;</span>: <span className="text-emerald-300">&quot;order_1042&quot;</span>,{"\n"}
              {"    "}<span className="text-amber-200">&quot;webhookUrl&quot;</span>: <span className="text-emerald-300">&quot;https://shop.example/hooks&quot;</span>{"\n"}
              {"  "}<span className="text-emerald-300">{"}'"}</span>
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}

function PricingTeaser({ fees }: { fees: FeeCopy }) {
  const tiers = pricingTiers(fees);
  return (
    <section className="py-20 md:py-28">
      <div className="container-site">
        <div className="mb-10 flex flex-col justify-between gap-6 md:mb-12 md:flex-row md:items-end">
          <SectionHeading
            align="left"
            title="Simple, volume-based pricing"
            subtitle={`Low fees: ${fees.range} of your monthly volume. No setup fee, no monthly minimum, no payout fees, because there are no payouts.`}
          />
          <ButtonLink href="/pricing" size="sm" className="shrink-0 self-start md:self-auto">
            See pricing
          </ButtonLink>
        </div>
        <div className="grid gap-6 md:grid-cols-3 md:gap-7.5">
          {tiers.map((t) => (
            <div key={t.name} className="frame">
              <div className="frame-inner p-6 md:p-8">
                <p className="mb-2 font-heading text-lg font-semibold text-default-950">{t.name}</p>
                <p className="font-heading text-[44px] font-semibold leading-none text-default-950">{t.rate}</p>
                <p className="mt-3 text-default-600">{t.volume}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomeFaq({ fees }: { fees: FeeCopy }) {
  return (
    <section className="pb-10">
      <div className="container-site max-w-245!">
        <SectionHeading title="Frequently asked questions" className="mb-10 md:mb-12" />
        <Accordion items={homeFaq(fees)} />
        <p className="mt-8 text-center">
          <Link href="/faq" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
            All questions <ChevronRight size={18} />
          </Link>
        </p>
      </div>
    </section>
  );
}
