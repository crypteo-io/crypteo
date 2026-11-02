import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { clipText, OG_CARDS, titleSize } from "./og-cards";
import { blogPostingJsonLd, faqJsonLd, pageMetadata } from "./seo";
import { sourceFiles } from "./testing/source-files";

describe("pageMetadata", () => {
  it("gives a page its own canonical and complete share fields", () => {
    const m = pageMetadata({ title: "Pricing", description: "D", path: "/pricing" });
    expect(m.alternates?.canonical).toBe("/pricing");
    expect(m.openGraph).toMatchObject({ url: "/pricing", title: "Pricing", description: "D", siteName: "Crypteo", type: "website" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Pricing" });
    expect(m.robots).toBeUndefined();
  });

  it("keeps sign-in steps out of the index but lets crawlers follow them", () => {
    expect(pageMetadata({ title: "Log In", description: "D", path: "/login", index: false }).robots).toEqual({
      index: false,
      follow: true,
    });
  });
});

describe("structured data", () => {
  it("builds FAQPage questions from the shown answers", () => {
    const data = faqJsonLd([{ q: "Q?", a: "A." }]);
    expect(data.mainEntity).toEqual([{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }]);
  });

  it("points a post at its absolute URL and share card", () => {
    const at = new Date("2026-10-01T00:00:00Z");
    const data = blogPostingJsonLd({ slug: "hello", title: "T", excerpt: "E", publishedAt: at, updatedAt: at });
    expect(data.url).toBe("https://crypteo.io/blog/hello");
    expect(data.image).toBe("https://crypteo.io/blog/hello/opengraph-image/card");
  });
});

describe("share cards", () => {
  it("fit the card: titles within 90 characters, subtitles within 120", () => {
    for (const card of Object.values(OG_CARDS)) {
      expect(card.title.length).toBeLessThanOrEqual(90);
      expect((card.subtitle ?? "").length).toBeLessThanOrEqual(120);
    }
  });

  it("never print a fee rate (rates come from the billed schedule)", () => {
    for (const card of Object.values(OG_CARDS)) expect(`${card.title} ${card.subtitle ?? ""}`).not.toMatch(/\d\s*%/);
  });

  it("clip long text at a word with an ellipsis", () => {
    expect(clipText("short", 10)).toBe("short");
    expect(clipText("one two three four five six", 15)).toBe("one two three…");
  });

  it("step long titles down a size", () => {
    expect(titleSize("Short")).toBeGreaterThan(titleSize("A much longer title that will need to wrap onto lines"));
  });
});

describe("share image coverage", () => {
  // A page that sets openGraph (pageMetadata does) loses the image it would
  // inherit from a parent segment, so each one needs its own route. Sign-in
  // pages deliberately have none.
  it("gives every public page built with pageMetadata its own opengraph-image", () => {
    const missing = sourceFiles(["app"])
      .filter((f) => /\/(page|layout)\.tsx$/.test(f.path) && f.text.includes("pageMetadata("))
      .filter((f) => !f.path.startsWith("app/(auth)/"))
      .map((f) => dirname(f.path))
      .filter((dir) => !existsSync(join(process.cwd(), dir, "opengraph-image.tsx")));
    expect(missing).toEqual([]);
  });
});
