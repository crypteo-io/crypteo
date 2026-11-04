import { CodeTabs } from "@/components/docs/CodeTabs";
import { DocsNav, type DocsNavGroup } from "@/components/docs/DocsNav";
import { ButtonLink } from "@/components/site/Button";
import { PageHero } from "@/components/site/PageHero";
import SiteShell from "@/components/site/SiteShell";
import { ArrowRight, Info } from "lucide-react";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { Fragment } from "react";
import { DOC_SECTIONS, type DocSection, type DocTable } from "./content";

export const metadata: Metadata = pageMetadata({
  title: "Crypto Payments API Integration Guide",
  description:
    "Integrate non-custodial crypto payments: create a payment, send the buyer to the hosted checkout and verify signed webhooks. Examples in cURL, Node.js and PHP.",
  path: "/docs",
});

// Sidebar groups over the section ids in ./content.ts.
const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Getting started", ids: ["overview", "auth"] },
  { title: "Payments", ids: ["create", "status", "statuses", "select-chain", "payment-links", "telegram"] },
  { title: "Webhooks", ids: ["webhooks", "verify", "handle"] },
  { title: "Reference", ids: ["errors", "test-mode", "tags-memos", "chains"] },
];

const byId = new Map(DOC_SECTIONS.map((s) => [s.id, s]));
const NAV: DocsNavGroup[] = GROUPS.map((g) => ({
  title: g.title,
  items: g.ids.flatMap((id) => {
    const s = byId.get(id);
    return s ? [{ id: s.id, label: s.title }] : [];
  }),
}));
// A section added to content.ts but not to GROUPS still renders, under Reference.
const grouped = new Set(GROUPS.flatMap((g) => g.ids));
const ungrouped = DOC_SECTIONS.filter((s) => !grouped.has(s.id));
if (ungrouped.length) NAV[NAV.length - 1].items.push(...ungrouped.map((s) => ({ id: s.id, label: s.title })));
const ORDERED = NAV.flatMap((g) => g.items.map((i) => byId.get(i.id)!));

export default function DocsPage() {
  return (
    <SiteShell>
      <PageHero
        eyebrow={<span className="eyebrow">Integration guide</span>}
        title="Accept crypto in your app"
        subtitle="Create a payment, send the buyer to the hosted checkout, and fulfil the order when a signed webhook says it's paid. Every payment settles straight to your own wallet."
      >
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href="/playground">Try it in the playground</ButtonLink>
          <ButtonLink href="/dashboard/api-keys" variant="white">
            Get an API key
          </ButtonLink>
        </div>
      </PageHero>

      <div className="container-site pt-6 pb-20 md:pt-10 md:pb-28">
        <div className="grid gap-10 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14">
          <aside>
            <DocsNav groups={NAV} />
          </aside>

          <div className="min-w-0 space-y-20 md:space-y-24">
            {ORDERED.map((doc) => (
              <SectionView key={doc.id} doc={doc} />
            ))}
            <HelpCard />
          </div>
        </div>
      </div>
    </SiteShell>
  );
}

/** Prose with `inline code` marked by backticks. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-default-100 px-1.5 py-0.5 font-mono text-[0.88em] text-default-900">
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function SectionView({ doc }: { doc: DocSection }) {
  return (
    <section id={doc.id} className="scroll-mt-32">
      <div className="flex items-center gap-4">
        <span className="icon-tile size-12 shrink-0">
          <doc.icon size={22} />
        </span>
        <h2 className="text-[28px] leading-tight md:text-[34px]">{doc.title}</h2>
      </div>
      <div className="mt-5 space-y-5 text-default-600">
        {doc.paragraphs.map((p, i) => (
          <p key={i} className="leading-relaxed">
            <Rich text={p} />
          </p>
        ))}
        {doc.notes && (
          <div className="flex gap-3 rounded-2xl border border-sky/20 bg-sky/5 p-5">
            <Info size={18} className="mt-0.5 shrink-0 text-sky" />
            <ul className="space-y-2 text-[15px] leading-relaxed text-default-700">
              {doc.notes.map((n, i) => (
                <li key={i}>
                  <Rich text={n} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {doc.tables?.map((t, i) => <DocTableView key={i} table={t} />)}
        {doc.examples && <CodeTabs examples={doc.examples} />}
      </div>
    </section>
  );
}

function DocTableView({ table }: { table: DocTable }) {
  return (
    <div className="space-y-3">
      {table.title && <h3 className="text-lg">{table.title}</h3>}
      <div className="overflow-x-auto rounded-2xl border border-default-200 bg-white">
        <table className="w-full min-w-[520px] text-left text-[14px]">
          <thead className="border-b border-default-200 bg-default-50">
            <tr>
              {table.columns.map((c) => (
                <th key={c} className="px-4 py-3 text-[13px] font-semibold text-default-700">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-default-100">
            {table.rows.map((row, r) => (
              <tr key={r} className="align-top">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={
                      c === 0
                        ? "whitespace-nowrap px-4 py-3 font-mono text-[13px] text-default-900"
                        : "px-4 py-3 leading-relaxed text-default-600"
                    }
                  >
                    <Rich text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HelpCard() {
  return (
    <div className="frame">
      <div className="frame-inner flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
        <div>
          <h2 className="text-2xl">Stuck on an integration?</h2>
          <p className="mt-2 text-default-600">
            Test the whole flow with a <code className="font-mono text-[0.9em]">test_</code> key in the playground,
            or tell us what you&apos;re building.
          </p>
        </div>
        <Link
          href="/contact"
          className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary hover:underline"
        >
          Contact us <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
