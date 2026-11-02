import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCHEDULE, feeCopy } from "@/lib/billing/fee-schedule";
import { OG_CARDS } from "@/lib/og-cards";
import { faqGroups, homeFaq, pricingFaq } from "./faq";
import { SOLUTION_KEYS, SOLUTIONS, solutionHeading, solutionSlug } from "./solution-links";
import { hostingComparison, solutionContent } from "./solutions";

const fees = feeCopy({
  ...DEFAULT_FEE_SCHEDULE,
  tiers: [
    { fromUsd: 0, percent: 0.35 },
    { fromUsd: 10_000, percent: 0.25 },
    { fromUsd: 50_000, percent: 0.1 },
  ],
});

describe("solution pages", () => {
  it("take their slug from the title, ignoring bracketed text", () => {
    expect(SOLUTIONS.map((s) => s.path)).toEqual([
      "/white-label-crypto-payment-gateway",
      "/open-source-crypto-payment-gateway",
      "/crypto-payment-gateway-api",
      "/decentralised-crypto-payment-gateway",
      "/crypto-payment-gateway-development-and-integration",
      "/wordpress-crypto-payment-gateway",
    ]);
    expect(solutionSlug("A (B) C")).toBe("a-c");
    expect(solutionHeading("Open Source Crypto Payment Gateway (Self Hosted)")).toBe("Open Source Crypto Payment Gateway");
  });

  it("each have a route, a share image and a share card", () => {
    for (const s of SOLUTIONS) {
      const dir = join(process.cwd(), "app", s.path.slice(1));
      expect(existsSync(join(dir, "page.tsx")), s.path).toBe(true);
      expect(existsSync(join(dir, "opengraph-image.tsx")), s.path).toBe(true);
      expect(OG_CARDS[s.key].title.length).toBeGreaterThan(0);
    }
  });

  it("keep meta descriptions under 160 characters", () => {
    for (const s of SOLUTIONS) expect(s.description.length, s.key).toBeLessThanOrEqual(160);
  });

  it("ask questions no other page asks", () => {
    const questions = [
      ...SOLUTION_KEYS.flatMap((k) => solutionContent(k, fees).faq),
      ...faqGroups(fees).flatMap((g) => g.items),
    ].map((i) => i.q);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("print fees only from the billed schedule", () => {
    const sentinel = { ...fees, range: "RANGE" };
    const copy = JSON.stringify([...SOLUTION_KEYS.map((k) => solutionContent(k, sentinel)), hostingComparison(sentinel)]);
    expect(copy).not.toMatch(/\d\s*%/);
    expect(JSON.stringify(solutionContent("openSource", sentinel).faq)).toContain("RANGE");
  });

  it("show the API docs' real create-payment request", () => {
    const section = solutionContent("api", fees).sections.find((s) => s.kind === "code");
    expect(section?.kind === "code" && section.examples.map((e) => e.label)).toEqual(["cURL", "Node.js", "Python", "PHP", "Response"]);
  });
});

describe("faq", () => {
  it("lists every fee tier from the schedule", () => {
    const answer = faqGroups(fees).flatMap((g) => g.items).find((i) => i.q === "What are the fees?")?.a ?? "";
    expect(answer).toContain("Starter 0.35% (Under $10,000 a month)");
    expect(answer).toContain("Scale 0.1% ($50,000+ a month)");
  });

  it("describes a flat fee as one rate", () => {
    const flat = feeCopy({ ...DEFAULT_FEE_SCHEDULE, tiers: [{ fromUsd: 0, percent: 0.5 }] });
    expect(pricingFaq(flat)[0].a).toMatch(/^A flat 0\.5% of your paid volume\./);
  });

  it("picks the home and pricing questions from the full list", () => {
    const all = new Set(faqGroups(fees).flatMap((g) => g.items.map((i) => i.q)));
    for (const item of [...homeFaq(fees), ...pricingFaq(fees)]) expect(all.has(item.q)).toBe(true);
  });
});
