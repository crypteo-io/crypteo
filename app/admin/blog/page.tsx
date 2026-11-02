import { BlogPostsClient } from "@/components/dashboard/BlogPostsClient";
import { adminPageSession } from "@/lib/admin";
import { siteOrigin } from "@/lib/admin-host";
import { prisma } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog",
  description: "Write and publish blog posts (Admin only).",
};

// Search runs client-side over this list; past this many posts the page
// needs server-side paging.
const MAX_POSTS_LISTED = 500;

export default async function BlogAdminPage() {
  await adminPageSession();

  const posts = await prisma.blogPost.findMany({
    orderBy: { updatedAt: "desc" },
    take: MAX_POSTS_LISTED,
    select: { id: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true },
  });
  return <BlogPostsClient posts={JSON.parse(JSON.stringify(posts))} siteOrigin={siteOrigin()} />;
}
