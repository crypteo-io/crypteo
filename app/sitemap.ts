import { SOLUTIONS } from "@/lib/content/solution-links";
import { prisma } from "@/lib/db";
import type { MetadataRoute } from "next";

const BASE_URL = "https://crypteo.io";

const STATIC_ROUTES: { path: string; priority: number }[] = [
  { path: "", priority: 1 },
  { path: "/pricing", priority: 0.9 },
  { path: "/faq", priority: 0.8 },
  { path: "/docs", priority: 0.8 },
  ...SOLUTIONS.map((s) => ({ path: s.path, priority: 0.8 })),
  { path: "/about", priority: 0.7 },
  { path: "/blog", priority: 0.7 },
  { path: "/playground", priority: 0.6 },
  { path: "/checkout-demo", priority: 0.6 },
  { path: "/contact", priority: 0.6 },
  { path: "/register", priority: 0.5 },
  { path: "/terms", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
];

// Rendered per request (one small query). Pre-rendered, it was built in the
// Docker image where there is no database, so every deploy shipped a sitemap
// without blog posts until its hourly refresh.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map(({ path, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "/blog" ? "weekly" : "monthly",
    priority,
  }));

  // A database outage must not take the static entries down with it.
  try {
    const posts = await prisma.blogPost.findMany({
      where: { status: "published", publishedAt: { lte: now } },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
    });
    for (const post of posts) {
      entries.push({
        url: `${BASE_URL}/blog/${post.slug}`,
        lastModified: post.updatedAt,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  } catch (err) {
    console.error("sitemap: could not load blog posts", err);
  }

  return entries;
}
