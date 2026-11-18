import { Accordion } from "@/components/site/Accordion";
import { ButtonLink } from "@/components/site/Button";
import { PageHero, SectionHeading } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { FeeCalculator } from "@/components/site/FeeCalculator";
import { feeCopy, type FeeSchedule } from "@/lib/billing/fee-schedule";
import { getPublicFeeSchedule } from "@/lib/billing/settings";
import { pricingFaq } from "@/lib/content/faq";
import { solutionLink } from "@/lib/content/solution-links";
import { PRICING_INCLUDED, pricingTiers, type PricingTier } from "@/lib/content/pricing";
import { cn } from "@/lib/utils";
import { BadgeCheck, Building2, Rocket, Sprout } from "lucide-react";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";

// Rendered per request: every figure comes from the admin's fee settings.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const fees = feeCopy(await getPublicFeeSchedule());
  return pageMetadata({
    title: "Low Fee Crypto Payment Gateway Pricing",
    description: `Low fee crypto payment gateway: ${fees.range} of monthly volume. No setup fee, no minimum, no payout fees, and self-hosting is free.`,
    path: "/pricing",
  });
}

const TIER_ICONS = [Sprout, Rocket, Building2];

const NOT_CHARGED = [
  { title: "No setup fee", body: "Create an account and start taking payments for free." },
  { title: "No monthly fee", body: "No subscription and no minimum volume. A quiet month costs nothing." },
  {
    title: "No payout or withdrawal fees",
    body: "There are no payouts: every payment lands in your own wallet directly.",
  },
  {
    title: "No network fee on your side",
    body: "The buyer pays the blockchain's network fee when they send, as with any on-chain transfer.",
  },
];

export default async function PricingPage() {
  const schedule = await getPublicFeeSchedule();
  const fees = feeCopy(schedule);
  return (
    <SiteShell>
      <PageHero title="Low fees, volume-based pricing">
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-default-700">
          <span>No setup fee</span>
          <span className="size-1 rounded-full bg-default-950" />
          <span>No monthly minimum</span>
          <span className="size-1 rounded-full bg-default-950" />
          <span>No payout fees</span>
        </div>
      </PageHero>

      <Tiers tiers={pricingTiers(fees)} />
      <Calculator schedule={schedule} />
      <NotCharged />
      <PricingFaq items={pricingFaq(fees)} />
    </SiteShell>
  );
}

function Tiers({ tiers }: { tiers: PricingTier[] }) {
  return (
    <section className="pb-20 md:pb-28">
      <div className="container-site">
        <SectionHeading
          align="left"
          title="One rate on your month's volume"
          subtitle="Your month's crypto volume sets one rate for all of it. Every tier gets every feature."
          subtitleClassName="text-[17px]"
          className="mb-8 lg:mb-12"
        />
        <div className={cn("grid gap-7.5", tiers.length >= 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
          {tiers.map((tier, i) => {
            const Icon = TIER_ICONS[i] ?? Rocket;
            return (
              <div key={tier.name} className={cn("frame", tier.featured && "border-sky/40")}>
                <div className="frame-inner p-6 md:p-7">
                  <span className="icon-tile mb-7 size-15">
                    <Icon size={28} />
                  </span>
                  <h3 className="mb-3 text-xl">{tier.name}</h3>
                  <p className="mb-6 min-h-12 text-default-600">{tier.blurb}</p>
                  <div className="mb-2 flex items-end gap-2">
                    <span className="font-heading text-[44px] font-semibold leading-none text-default-950">
                      {tier.rate}
                    </span>
                    <span className="pb-1 text-default-600">of volume</span>
                  </div>
                  <p className="mb-7 font-medium text-default-900">{tier.volume}</p>
                  <ButtonLink href="/register" className="w-full">
                    Get started
                  </ButtonLink>
                </div>
                <ul className="space-y-2.5 p-5">
                  {PRICING_INCLUDED.map((item) => (
                    <li key={item} className="flex items-center gap-2.5 text-default-700">
                      <BadgeCheck size={20} className="shrink-0 fill-default-900 text-white" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-8 text-center text-default-600">
          Rather run it yourself? Crypteo is open source, and a self-hosted instance pays no platform fee.{" "}
          <Link href={solutionLink("openSource").path} className="font-medium text-primary hover:underline">
            How self-hosting works
          </Link>
        </p>
      </div>
    </section>
  );
}

function NotCharged() {
  return (
    <section className="relative isolate overflow-hidden py-20 md:py-28">
      <div className="absolute inset-0 -z-10 bg-linear-to-b from-white via-[#dbe9f7] to-white" />
      <div className="container-site">
        <SectionHeading
          title="What you don't pay"
          subtitle="The percentage above is the whole bill."
          className="mb-10 md:mb-12"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-7.5">
          {NOT_CHARGED.map((item) => (
            <div key={item.title} className="frame">
              <div className="frame-inner h-full p-6">
                <h3 className="mb-2 text-lg md:text-xl">{item.title}</h3>
                <p className="text-default-600">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Calculator({ schedule }: { schedule: FeeSchedule }) {
  return (
    <section className="py-20 md:py-28">
      <div className="container-site">
        <SectionHeading
          title="Work out your monthly fee"
          subtitle="Move the slider to your usual month and see it next to three well-known crypto gateways."
          className="mb-10 md:mb-12"
        />
        <FeeCalculator schedule={schedule} />
      </div>
    </section>
  );
}

function PricingFaq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <section className="pb-10">
      <div className="container-site max-w-245!">
        <SectionHeading title="Pricing questions" className="mb-10 md:mb-12" />
        <Accordion items={items} />
        <p className="mt-8 text-center">
          <Link href="/faq" className="font-medium text-primary hover:underline">
            See all questions
          </Link>
        </p>
      </div>
    </section>
  );
}
