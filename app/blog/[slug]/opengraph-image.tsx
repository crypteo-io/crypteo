import { isValidSlug } from "@/lib/blog/post";
import { getPublishedPost } from "@/lib/blog/queries";
import { OG_CARDS } from "@/lib/og-cards";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { BLOG_POST_IMAGE_ID } from "@/lib/seo";
import { notFound } from "next/navigation";

type Params = { params: Promise<{ slug?: string }> };

// Rendered on request from the post, so an edited title shows at once; a
// cached card would keep the old one (revalidateBlog purges pages, not this).
export const dynamic = "force-dynamic";

// The build calls generateImageMetadata without a slug while collecting routes.
async function loadPost(slug: string | undefined) {
  return slug && isValidSlug(slug) ? getPublishedPost(slug) : ({ ok: true, data: null } as const);
}

/**
 * One card per post, so its alt text can be the post's title (a static `alt`
 * export can't read the post). Served at /blog/<slug>/opengraph-image/card.
 */
export async function generateImageMetadata({ params }: Params) {
  const result = await loadPost((await params).slug);
  const title = result.ok && result.data ? result.data.title : OG_CARDS.blog.title;
  return [{ id: BLOG_POST_IMAGE_ID, alt: title, size: OG_SIZE, contentType: OG_CONTENT_TYPE }];
}

export default async function Image({ params }: Params) {
  const result = await loadPost((await params).slug);
  // A failed query must not be cached as an image (or a 404): throw, so the
  // next request tries again.
  if (!result.ok) throw new Error("Blog post unavailable");
  if (!result.data) notFound();
  return ogImage({ eyebrow: "Blog", title: result.data.title, subtitle: result.data.excerpt });
}
