import { BlogEditorClient } from "@/components/dashboard/BlogEditorClient";
import { adminPageSession } from "@/lib/admin";
import { siteOrigin } from "@/lib/admin-host";
import { renderMarkdown } from "@/lib/blog/markdown";
import { prisma } from "@/lib/db";
import { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Edit post",
};

export default async function EditBlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await adminPageSession();
  const { id } = await params;

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      content: true,
      format: true,
      coverImageUrl: true,
      status: true,
      updatedAt: true,
    },
  });
  if (!post) notFound();

  // The editor is rich text only. A Markdown post opens as its rendered,
  // sanitised HTML and is stored as HTML from its next save.
  const fromMarkdown = post.format !== "html";
  return (
    <BlogEditorClient
      key={post.id}
      post={{
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        coverImageUrl: post.coverImageUrl,
        status: post.status,
        content: fromMarkdown ? renderMarkdown(post.content) : post.content,
        updatedAt: post.updatedAt.toISOString(),
        fromMarkdown,
      }}
      siteOrigin={siteOrigin()}
    />
  );
}
