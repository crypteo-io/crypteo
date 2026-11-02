import type { Metadata } from "next";
import type { FaqItem } from "./content/faq";

export const SITE_NAME = "Crypteo";
export const SITE_URL = "https://crypteo.io";
const SUPPORT_EMAIL = "support@crypteo.io";

/**
 * A public page's metadata: its own canonical URL, and the Open Graph and
 * Twitter fields share previews read. A page that sets `openGraph` replaces
 * the root's object rather than merging into it, so every field is set here.
 * The image itself comes from the page's opengraph-image.tsx (lib/og.tsx).
 * Titles name the page with its search terms (the root template adds
 * "| Crypteo"); descriptions stay under ~160 characters so results don't cut them.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  /** For the home page: the title as given, without the "| Crypteo" template. */
  absoluteTitle?: boolean;
  /** False for pages with nothing to find (sign-in steps): crawled, not listed. */
  index?: boolean;
}): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    ...(index ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: path, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** For pages that belong to one buyer or one session (checkout, payment links). */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false };

// schema.org JSON-LD, rendered by components/site/JsonLd.tsx.
type JsonLdObject = { "@context": "https://schema.org"; "@type": string; [key: string]: unknown };

const absolute = (path: string) => new URL(path, SITE_URL).toString();

export function organizationJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: absolute("/apple-icon.png"),
    email: SUPPORT_EMAIL,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SUPPORT_EMAIL },
  };
}

export function websiteJsonLd(): JsonLdObject {
  return { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_URL };
}

export function faqJsonLd(items: FaqItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
}

/** The id of a post's one generated card (app/blog/[slug]/opengraph-image.tsx). */
export const BLOG_POST_IMAGE_ID = "card";

export function blogPostingJsonLd(post: {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date;
  updatedAt: Date;
}): JsonLdObject {
  const url = absolute(`/blog/${post.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    url,
    mainEntityOfPage: url,
    image: absolute(`/blog/${post.slug}/opengraph-image/${BLOG_POST_IMAGE_ID}`),
    datePublished: post.publishedAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: absolute("/apple-icon.png") } },
  };
}

export function breadcrumbJsonLd(trail: { name: string; path: string }[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: absolute(t.path) })),
  };
}
