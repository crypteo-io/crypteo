import { auditLog, requireAdmin } from "@/lib/admin";
import { nextPublishedAt, SLUG_TAKEN, updatePostSchema } from "@/lib/blog/post";
import { revalidateBlog } from "@/lib/blog/revalidate";
import { recordVersion, versionEvent } from "@/lib/blog/versions";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const ID = /^[a-z0-9]{20,40}$/;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

const POST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  format: true,
  coverImageUrl: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return fail("Invalid post id", 400);

  try {
    const post = await prisma.blogPost.findUnique({ where: { id }, select: POST_SELECT });
    if (!post) return fail("Post not found", 404);
    return NextResponse.json({ post });
  } catch (error) {
    console.error("[admin/blog/:id]", error);
    return fail("Could not load the post", 500);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return fail("Invalid post id", 400);
  const parsed = updatePostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }
  const changes = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.blogPost.findUnique({
        where: { id },
        select: { status: true, publishedAt: true, slug: true },
      });
      if (!current) return null;
      const status = changes.status ?? (current.status as "draft" | "published");
      const post = await tx.blogPost.update({
        where: { id },
        data: { ...changes, publishedAt: nextPublishedAt(status, current.publishedAt) },
        select: POST_SELECT,
      });
      await recordVersion(tx, post, admin.id, versionEvent(current.status, post.status));
      await auditLog(tx, admin, id, "blog.update", {
        slug: post.slug,
        fields: Object.keys(changes),
        ...(changes.status && changes.status !== current.status ? { status: changes.status } : {}),
      });
      return { post, previousSlug: current.slug };
    });
    if (!result) return fail("Post not found", 404);
    revalidateBlog([result.previousSlug, result.post.slug]);
    return NextResponse.json({ post: result.post });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(SLUG_TAKEN, 409);
    }
    console.error("[admin/blog/:id]", error);
    return fail("Could not update the post", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  if (!ID.test(id)) return fail("Invalid post id", 400);

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const post = await tx.blogPost.findUnique({
        where: { id },
        select: { slug: true, title: true },
      });
      if (!post) return null;
      await tx.blogPost.delete({ where: { id } });
      await auditLog(tx, admin, id, "blog.delete", { slug: post.slug, title: post.title });
      return post.slug;
    });
    if (!deleted) return fail("Post not found", 404);
    revalidateBlog([deleted]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/blog/:id]", error);
    return fail("Could not delete the post", 500);
  }
}
