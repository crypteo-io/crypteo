import { prisma } from "@/lib/db";
import { cache } from "react";
import { BLOG_PAGE_SIZE, MAX_BLOG_PAGE, readingTimeMinutes } from "./post";

export interface BlogCard {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  publishedAt: Date;
  readingMinutes: number;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false };

const PUBLISHED = { status: "published", publishedAt: { not: null } } as const;

/**
 * One page of published posts, newest first. A failed query is { ok: false },
 * never an empty page: "the blog is down" must not read as "no posts yet".
 */
export async function listPublishedPosts(
  page: number,
): Promise<Loaded<{ posts: BlogCard[]; totalPages: number }>> {
  try {
    const [rows, total] = await Promise.all([
      prisma.blogPost.findMany({
        where: PUBLISHED,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * BLOG_PAGE_SIZE,
        take: BLOG_PAGE_SIZE,
        select: {
          slug: true,
          title: true,
          excerpt: true,
          coverImageUrl: true,
          publishedAt: true,
          content: true,
        },
      }),
      prisma.blogPost.count({ where: PUBLISHED, take: BLOG_PAGE_SIZE * MAX_BLOG_PAGE }),
    ]);
    const posts = rows.map(({ content, publishedAt, ...rest }) => ({
      ...rest,
      publishedAt: publishedAt!,
      readingMinutes: readingTimeMinutes(content),
    }));
    return { ok: true, data: { posts, totalPages: Math.max(1, Math.ceil(total / BLOG_PAGE_SIZE)) } };
  } catch (error) {
    console.error("[blog] list failed", error);
    return { ok: false };
  }
}

/**
 * A published post by slug, or null when there is none (drafts included).
 * Cached per request so generateMetadata and the page share one query.
 */
export const getPublishedPost = cache(
  async (
    slug: string,
  ): Promise<Loaded<(BlogCard & { content: string; format: string; updatedAt: Date }) | null>> => {
    try {
      const post = await prisma.blogPost.findFirst({
        where: { slug, ...PUBLISHED },
        select: {
          slug: true,
          title: true,
          excerpt: true,
          coverImageUrl: true,
          publishedAt: true,
          updatedAt: true,
          content: true,
          format: true,
        },
      });
      if (!post) return { ok: true, data: null };
      return {
        ok: true,
        data: {
          ...post,
          publishedAt: post.publishedAt!,
          readingMinutes: readingTimeMinutes(post.content),
        },
      };
    } catch (error) {
      console.error("[blog] post lookup failed", error);
      return { ok: false };
    }
  },
);

/** Other published posts for the "keep reading" strip. Best effort: [] on failure. */
export async function recentPublishedPosts(excludeSlug: string, limit: number): Promise<BlogCard[]> {
  try {
    const rows = await prisma.blogPost.findMany({
      where: { ...PUBLISHED, slug: { not: excludeSlug } },
      orderBy: { publishedAt: "desc" },
      take: limit,
      select: {
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        publishedAt: true,
        content: true,
      },
    });
    return rows.map(({ content, publishedAt, ...rest }) => ({
      ...rest,
      publishedAt: publishedAt!,
      readingMinutes: readingTimeMinutes(content),
    }));
  } catch (error) {
    console.error("[blog] recent posts failed", error);
    return [];
  }
}

/** A post date as readers see it, fixed to UTC so it never depends on the server's zone. */
export function formatPostDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
