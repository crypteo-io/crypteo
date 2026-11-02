import { describe, expect, it } from "vitest";
import {
  createPostSchema,
  isValidSlug,
  MAX_BLOG_PAGE,
  MAX_SLUG_LENGTH,
  nextPublishedAt,
  parseBlogPage,
  readingTimeMinutes,
  slugify,
  updatePostSchema,
} from "./post";

const VALID = {
  title: "Hello",
  slug: "hello",
  excerpt: "Short summary",
  content: "Body",
};

describe("slugify", () => {
  it("turns a title into a URL slug", () => {
    expect(slugify("Why you should receive crypto payments in a self-custody wallet")).toBe(
      "why-you-should-receive-crypto-payments-in-a-self-custody-wallet",
    );
    expect(slugify("What 'non-custodial' actually means for your store")).toBe(
      "what-non-custodial-actually-means-for-your-store",
    );
  });

  it("drops accents, punctuation and stray hyphens", () => {
    expect(slugify("  Café & Crème — 2026!  ")).toBe("cafe-and-creme-2026");
    expect(slugify("--a---b--")).toBe("a-b");
    expect(slugify("¿¡!?")).toBe("");
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(MAX_SLUG_LENGTH - 1)} bcd`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(isValidSlug("non-custodial-101")).toBe(true);
  });

  it("refuses anything else", () => {
    for (const s of ["", "Upper", "a--b", "-a", "a-", "a b", "a/b", "../x", "a".repeat(MAX_SLUG_LENGTH + 1)]) {
      expect(isValidSlug(s), s).toBe(false);
    }
  });
});

describe("readingTimeMinutes", () => {
  it("is at least one minute", () => {
    expect(readingTimeMinutes("")).toBe(1);
    expect(readingTimeMinutes("a few words")).toBe(1);
  });

  it("scales with word count at about 220 words a minute", () => {
    expect(readingTimeMinutes("word ".repeat(1100))).toBe(5);
  });

  it("doesn't count code blocks or Markdown syntax as words", () => {
    expect(readingTimeMinutes("## # ** -\n```\n" + "x ".repeat(5000) + "\n```")).toBe(1);
  });
});

describe("parseBlogPage", () => {
  it("defaults anything odd to page 1 and caps the top", () => {
    expect(parseBlogPage(undefined)).toBe(1);
    expect(parseBlogPage("abc")).toBe(1);
    expect(parseBlogPage("0")).toBe(1);
    expect(parseBlogPage("-3")).toBe(1);
    expect(parseBlogPage("2.5")).toBe(1);
    expect(parseBlogPage(["3", "4"])).toBe(3);
    expect(parseBlogPage("999999")).toBe(MAX_BLOG_PAGE);
  });
});

describe("createPostSchema", () => {
  it("defaults to a draft with no cover", () => {
    const parsed = createPostSchema.parse({ ...VALID, coverImageUrl: "" });
    expect(parsed.status).toBe("draft");
    expect(parsed.coverImageUrl).toBeNull();
  });

  it("refuses a bad slug, a non-https cover and an unknown status", () => {
    expect(createPostSchema.safeParse({ ...VALID, slug: "Bad Slug" }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...VALID, coverImageUrl: "http://x.co/a.png" }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...VALID, coverImageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...VALID, status: "archived" }).success).toBe(false);
  });

  it("requires title, excerpt and content", () => {
    expect(createPostSchema.safeParse({ ...VALID, title: "   " }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...VALID, excerpt: "   " }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...VALID, content: "" }).success).toBe(false);
  });
});

describe("updatePostSchema", () => {
  it("leaves fields it isn't given untouched", () => {
    const parsed = updatePostSchema.parse({ status: "published" });
    expect(parsed).toEqual({ status: "published" });
    expect("coverImageUrl" in parsed).toBe(false);
  });

  it("clears the cover on an empty string", () => {
    expect(updatePostSchema.parse({ coverImageUrl: "" }).coverImageUrl).toBeNull();
  });

  it("refuses an empty update", () => {
    expect(updatePostSchema.safeParse({}).success).toBe(false);
  });
});

describe("nextPublishedAt", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const earlier = new Date("2026-01-01T00:00:00Z");

  it("stamps the first publish", () => {
    expect(nextPublishedAt("published", null, now)).toBe(now);
  });

  it("keeps the original date on re-publish and on unpublish", () => {
    expect(nextPublishedAt("published", earlier, now)).toBe(earlier);
    expect(nextPublishedAt("draft", earlier, now)).toBe(earlier);
  });

  it("leaves a never-published draft undated", () => {
    expect(nextPublishedAt("draft", null, now)).toBeNull();
  });
});
