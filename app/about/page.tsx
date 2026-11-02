import { COINS } from "@/components/home/coins";
import { ButtonLink } from "@/components/site/Button";
import { CtaPanel } from "@/components/site/CtaPanel";
import { ListCard } from "@/components/site/ListCard";
import { LogoMark } from "@/components/site/Logo";
import { PageHero, SectionHeading } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { solutionLink } from "@/lib/content/solution-links";
import { ArrowRight, Eye, KeyRound, Scale, ShieldCheck, User, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function AboutPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow={<span className="eyebrow">About Crypteo</span>}
        title="Crypto payments that never pass through us"
        subtitle={
          <>
            <strong className="font-semibold text-default-950">Crypteo</strong> is a non-custodial crypto
            payment gateway: decentralised, open source and white label. Your buyers pay your own wallet directly. We watch the public blockchain,
            tell you when the money has arrived, and stay out of the way.
          </>
        }
      />
      <FlowVisual />
      <WhyWeBuiltIt />
      <DoAndDont />
      <Values />
      <CtaPanel
        title="Get paid straight to your wallet"
        body="Create an account, add your receiving addresses and take your first payment in minutes."
      >
        <ButtonLink href="/register">Start accepting crypto</ButtonLink>
        <ButtonLink href="/contact" variant="white">
          Talk to us
        </ButtonLink>
      </CtaPanel>
    </SiteShell>
  );
}

/** The about-image slot of the template, drawn as the actual payment path instead of a stock photo. */
function FlowVisual() {
  const orbit = COINS.slice(0, 8);
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site">
        <div className="frame">
          <div className="frame-inner relative overflow-hidden bg-linear-to-b from-[#eef5fc] to-white px-5 py-10 md:px-12 md:py-16">
            <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center gap-6 opacity-70 md:gap-10">
              {orbit.map((c, i) => (
                <Image
                  key={c.symbol}
                  src={c.icon}
                  alt=""
                  width={36}
                  height={36}
                  className={`size-7 rounded-full md:size-9 ${i % 2 ? "translate-y-3" : ""}`}
                />
              ))}
            </div>

            <div className="relative mt-14 grid items-center gap-5 md:mt-16 md:grid-cols-[1fr_auto_1fr] md:gap-8">
              <FlowNode icon={User} label="Buyer's wallet" note="Any wallet or exchange account" />
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="hidden h-px w-40 bg-linear-to-r from-transparent via-sky to-transparent md:block" />
                <span className="font-heading text-sm font-semibold uppercase tracking-wider text-sky">
                  On-chain transfer
                </span>
                <ArrowRight size={22} className="rotate-90 text-sky md:rotate-0" />
              </div>
              <FlowNode icon={Wallet} label="Your wallet" note="Self-custody: you hold the keys" highlight />
            </div>

            <div className="relative mx-auto mt-8 flex max-w-md items-center gap-4 rounded-2xl border border-dashed border-default-300 bg-white/80 p-4 md:mt-10">
              <LogoMark className="size-10" />
              <div>
                <p className="font-heading font-semibold text-default-950">Crypteo watches, never touches</p>
                <p className="text-sm text-default-600">
                  Reads the public chain, matches the payment, sends your webhook.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowNode({
  icon: Icon,
  label,
  note,
  highlight,
}: {
  icon: typeof Wallet;
  label: string;
  note: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 text-center shadow-sm md:p-6 ${
        highlight ? "border-sky/40" : "border-default-200"
      }`}
    >
      <span className="icon-tile mb-4 size-12">
        <Icon size={22} />
      </span>
      <p className="font-heading text-xl font-semibold text-default-950">{label}</p>
      <p className="mt-1 text-default-600">{note}</p>
    </div>
  );
}

function WhyWeBuiltIt() {
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site grid gap-10 lg:grid-cols-2 lg:gap-16">
        <SectionHeading
          align="left"
          title="Why we built it"
          subtitle="Taking crypto shouldn't mean handing someone else the power to say no."
        />
        <div className="space-y-5 text-lg text-default-600">
          <p>
            Card processors and custodial payment platforms hold your revenue before you see it. One risk
            review, one change of policy, and a business finds its account frozen, its payouts paused and its
            balance locked behind a support queue.
          </p>
          <p>
            Paying out to an exchange isn&apos;t much better. Exchanges screen every incoming transfer, so
            a store receiving to an exchange deposit address ends up explaining where each payment came from,
            or waiting on deposits that have been held. And some buyers&apos; exchanges refuse to send to
            known payment platforms at all.
          </p>
          <p>
            Crypteo removes the middle. Buyers pay a plain address in your own wallet, which looks to their
            exchange like an ordinary withdrawal. The funds are yours the moment the transaction confirms, and
            there is nothing for anyone to freeze.
          </p>
          <p>
            We also made it open source and white label. The code is public under the MIT licence, so you can
            read exactly what it does with your payments or{" "}
            <Link href={solutionLink("openSource").path} className="font-medium text-primary hover:underline">
              run your own instance
            </Link>
            , and every checkout carries the merchant&apos;s brand, not ours.
          </p>
        </div>
      </div>
    </section>
  );
}

function DoAndDont() {
  const does = [
    "Read public blockchain data to detect and confirm payments",
    "Match each incoming transaction to the order it pays for",
    "Host the checkout page and payment links your buyers use",
    "Send signed webhooks and email alerts when a payment's status changes",
  ];
  const doesNot = [
    "Hold, receive or forward your funds",
    "Ask for private keys or seed phrases. We only store public addresses",
    "Approve, delay or reverse payouts. There are no payouts",
    "Sit between you and your buyer in a way that lets us block a payment",
  ];
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site">
        <SectionHeading title="What we do, and what we don't" className="mb-10 md:mb-12" />
        <div className="grid gap-6 md:grid-cols-2 md:gap-7.5">
          <ListCard title="What Crypteo does" items={does} good />
          <ListCard title="What Crypteo never does" items={doesNot} />
        </div>
      </div>
    </section>
  );
}

function Values() {
  const values = [
    {
      icon: KeyRound,
      title: "Your keys, your money",
      body: "Non-custody isn't a setting we can switch off. The system never has the keys, so it can never move your funds.",
    },
    {
      icon: Eye,
      title: "Verifiable on-chain",
      body: "Every payment we report is a public transaction you can look up yourself in any block explorer.",
    },
    {
      icon: ShieldCheck,
      title: "Safe by default",
      body: "A failed chain read is never treated as a missing payment, and every webhook is signed so you can verify it came from us.",
    },
    {
      icon: Scale,
      title: "Low, plain pricing",
      body: "One low percentage on your monthly volume. No setup fee, no monthly minimum, no payout fees, and no platform fee at all if you self-host.",
    },
  ];
  return (
    <section className="relative isolate overflow-hidden py-20 md:py-28">
      <div className="absolute inset-0 -z-10 bg-linear-to-b from-white via-[#dbe9f7] to-white" />
      <div className="container-site">
        <SectionHeading
          title="What we care about"
          subtitle="The principles behind how Crypteo is built."
          className="mb-10 md:mb-12"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7.5">
          {values.map(({ icon: Icon, title, body }) => (
            <div key={title} className="frame">
              <div className="frame-inner h-full p-6">
                <span className="icon-tile mb-6 size-12">
                  <Icon size={22} />
                </span>
                <h3 className="mb-3 text-xl">{title}</h3>
                <p className="text-default-600">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
