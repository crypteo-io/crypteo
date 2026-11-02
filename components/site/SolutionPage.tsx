import { CodeTabs } from "@/components/docs/CodeTabs";
import { Accordion } from "@/components/site/Accordion";
import { ButtonAnchor, ButtonLink } from "@/components/site/Button";
import { CtaPanel } from "@/components/site/CtaPanel";
import { FeatureCard } from "@/components/site/FeatureCard";
import { HostingComparison } from "@/components/site/HostingComparison";
import { JsonLd } from "@/components/site/JsonLd";
import { ListCard } from "@/components/site/ListCard";
import { PageHero, SectionHeading } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { feeCopy, type FeeCopy } from "@/lib/billing/fee-schedule";
import { getPublicFeeSchedule } from "@/lib/billing/settings";
import { SOLUTIONS, solutionHeading, solutionLink, type SolutionKey } from "@/lib/content/solution-links";
import {
  hostingComparison,
  solutionContent,
  type SolutionLinkTarget,
  type SolutionSection,
} from "@/lib/content/solutions";
import { cn } from "@/lib/utils";
import { faqJsonLd } from "@/lib/seo";
import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";

/** The shared template behind the six solution pages; copy comes from lib/content/solutions.ts. */
export default async function SolutionPage({ id }: { id: SolutionKey }) {
  const fees = feeCopy(await getPublicFeeSchedule());
  const link = solutionLink(id);
  const page = solutionContent(id, fees);
  return (
    <SiteShell>
      <JsonLd data={faqJsonLd(page.faq)} />
      <PageHero eyebrow={<span className="eyebrow">{page.eyebrow}</span>} title={solutionHeading(link.title)} subtitle={page.subtitle}>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Action target={page.primary} />
          <Action target={page.secondary} variant="white" />
        </div>
      </PageHero>

      <section className="pb-20 md:pb-28">
        <div className="container-site">
          <SectionHeading title={page.featuresTitle} className="mb-10 md:mb-12" />
          <div className={cn("grid gap-6 md:grid-cols-2 md:gap-7.5", page.features.length === 3 && "lg:grid-cols-3")}>
            {page.features.map((f) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} body={f.body} />
            ))}
          </div>
        </div>
      </section>

      {page.sections.map((section, i) => (
        <Section key={section.title} section={section} fees={fees} tinted={i % 2 === 0} />
      ))}

      <section className="py-20 md:py-28">
        <div className="container-site max-w-245!">
          <SectionHeading title="Questions people ask" className="mb-10 md:mb-12" />
          <Accordion items={page.faq} />
          <p className="mt-8 text-center">
            <Link href="/faq" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
              All questions <ChevronRight size={18} />
            </Link>
          </p>
        </div>
      </section>

      <MoreSolutions current={id} />

      <CtaPanel
        title={page.ctaTitle}
        body={`Hosted Crypteo costs ${fees.range} of your monthly volume with nothing up front, or self-host it and pay no platform fee.`}
      >
        <ButtonLink href="/register">Start accepting crypto</ButtonLink>
        <ButtonLink href="/contact" variant="white">
          Talk to us
        </ButtonLink>
      </CtaPanel>
    </SiteShell>
  );
}

function Action({ target, variant = "primary" }: { target: SolutionLinkTarget; variant?: "primary" | "white" }) {
  const icon = variant === "primary" ? <ArrowRight size={18} /> : undefined;
  return target.plain ? (
    <ButtonAnchor href={target.href} variant={variant} icon={icon}>
      {target.label}
    </ButtonAnchor>
  ) : (
    <ButtonLink href={target.href} variant={variant} icon={icon}>
      {target.label}
    </ButtonLink>
  );
}

function Section({ section, fees, tinted }: { section: SolutionSection; fees: FeeCopy; tinted: boolean }) {
  return (
    <section className={cn("relative isolate overflow-hidden", tinted ? "py-20 md:py-28" : "pb-20 md:pb-28")}>
      {tinted && <div className="absolute inset-0 -z-10 bg-linear-to-b from-white via-[#dbe9f7] to-white" />}
      <div className="container-site">
        <SectionBody section={section} fees={fees} />
      </div>
    </section>
  );
}

function SectionBody({ section, fees }: { section: SolutionSection; fees: FeeCopy }) {
  switch (section.kind) {
    case "steps":
      return (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <SectionHeading align="left" title={section.title} subtitle={section.subtitle} className="lg:sticky lg:top-36 lg:self-start" />
          <div className="frame">
            <ol className="frame-inner divide-y divide-default-100">
              {section.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4 p-5 md:gap-5 md:p-7">
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-heading text-sm font-semibold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="mb-1.5 text-lg md:text-xl">{step.title}</h3>
                    <p className="text-[15px] font-normal text-default-600">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      );
    case "hosting":
      return (
        <div className="mx-auto max-w-245">
          <SectionHeading title={section.title} subtitle={section.subtitle} className="mb-10 md:mb-12" />
          <HostingComparison rows={hostingComparison(fees)} />
        </div>
      );
    case "code":
      return (
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <SectionHeading align="left" title={section.title} subtitle={section.subtitle} />
            <ol className="mt-6 space-y-3">
              {section.next.map((line, i) => (
                <li key={line} className="flex gap-3 text-default-700">
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-sky text-xs font-semibold text-white">
                    {i + 1}
                  </span>
                  {line}
                </li>
              ))}
            </ol>
            <ButtonLink href="/docs#create" variant="white" className="mt-8" icon={<ArrowRight size={18} />}>
              Full request reference
            </ButtonLink>
          </div>
          <div className="frame min-w-0">
            <CodeTabs examples={section.examples} />
          </div>
        </div>
      );
    case "contrast":
      return (
        <>
          <SectionHeading title={section.title} subtitle={section.subtitle} className="mb-10 md:mb-12" />
          <div className="grid gap-6 md:grid-cols-2 md:gap-7.5">
            <ListCard title="Crypteo" items={section.ours} good />
            <ListCard title={section.theirsTitle} items={section.theirs} />
          </div>
        </>
      );
  }
}

function MoreSolutions({ current }: { current: SolutionKey }) {
  return (
    <section className="pb-4">
      <div className="container-site">
        <h2 className="mb-6 text-2xl md:text-[28px]">More ways to use Crypteo</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {SOLUTIONS.filter((s) => s.key !== current).map((s) => (
            <li key={s.key}>
              <Link
                href={s.path}
                className="group flex h-full flex-col rounded-2xl border border-default-200 bg-white p-5 transition-colors hover:border-primary/40"
              >
                <span className="flex items-center justify-between gap-2 font-heading font-semibold text-default-950">
                  {s.label}
                  <ArrowRight size={16} className="shrink-0 text-default-400 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                </span>
                <span className="mt-1.5 text-sm font-normal text-default-600">{s.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
