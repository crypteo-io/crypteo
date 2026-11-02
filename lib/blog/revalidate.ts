import { revalidatePath } from "next/cache";

/**
 * Cache busting for every page a post change shows up on. A post page is
 * rendered on its first visit and then served from Next's cache, so without
 * this a published edit stayed invisible.
 * Called after the database write commits; pass every slug the post had
 * (old and new on a rename) so neither URL serves a stale copy.
 */
export function revalidateBlog(slugs: string[]): void {
  revalidatePath("/blog");
  for (const slug of new Set(slugs)) revalidatePath(`/blog/${slug}`);
}
