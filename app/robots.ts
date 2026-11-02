import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // Checkout and payment-link pages stay crawlable so share previews
    // (Twitterbot obeys robots.txt) can read them; they carry noindex instead.
    // Blog images are served from /api/blog-media/.
    rules: {
      userAgent: "*",
      allow: ["/", "/api/blog-media/"],
      disallow: ["/api/", "/dashboard/"],
    },
    sitemap: "https://crypteo.io/sitemap.xml",
  };
}
