import { Accordion } from "@/components/site/Accordion";
import { ButtonLink } from "@/components/site/Button";
import { JsonLd } from "@/components/site/JsonLd";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { feeCopy } from "@/lib/billing/fee-schedule";
import { getPublicFeeSchedule } from "@/lib/billing/settings";
import { faqGroups } from "@/lib/content/faq";
import type { Metadata } from "next";
import { faqJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Crypto Payment Gateway FAQ",
  description:
    "Answers about Crypteo's non-custodial crypto payment gateway: no KYC, white label, self-hosting, wallets, fees, supported coins and integration.",
  path: "/faq",
});

// Rendered per request: the fee answer comes from the admin's fee settings.
export const dynamic = "force-dynamic";

function slug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export default async function FaqPage() {
  const groups = faqGroups(feeCopy(await getPublicFeeSchedule()));
  return (
    <SiteShell>
      {/* Built from the same data as the page, so the structured answers never drift from what's shown. */}
      <JsonLd data={faqJsonLd(groups.flatMap((g) => g.items))} />
      <PageHero
        title="Frequently asked questions"
        subtitle="How Crypteo's non-custodial payments work, where to receive them, what they cost, and how to brand or self-host the gateway."
      />

      <section className="pb-20 md:pb-28">
        <div className="container-site max-w-245!">
          <nav aria-label="FAQ sections" className="mb-12 flex flex-wrap justify-center gap-2.5">
            {groups.map((g) => (
              <a
                key={g.title}
                href={`#${slug(g.title)}`}
                className="rounded-xl border border-default-200 bg-white px-4 py-2 text-sm font-medium text-default-700 transition-colors hover:border-primary hover:text-primary"
              >
                {g.title}
              </a>
            ))}
          </nav>

          <div className="space-y-14 md:space-y-16">
            {groups.map((g) => (
              <section key={g.title} id={slug(g.title)} className="scroll-mt-32">
                <h2 className="mb-6 text-[28px] leading-[1.2] md:mb-8 md:text-[36px]">{g.title}</h2>
                <Accordion items={g.items} defaultOpen={null} />
              </section>
            ))}
          </div>

          <div className="frame mt-16 md:mt-20">
            <div className="frame-inner flex flex-col items-center gap-5 px-6 py-10 text-center md:flex-row md:justify-between md:px-10 md:text-left">
              <div>
                <h2 className="text-2xl md:text-[28px]">Still have a question?</h2>
                <p className="mt-2 text-default-600">Send us a message and a person on the team will get back to you.</p>
              </div>
              <ButtonLink href="/contact" className="shrink-0">
                Contact us
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
