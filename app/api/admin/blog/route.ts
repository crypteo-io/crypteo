import { auditLog, requireAdmin } from "@/lib/admin";
import { createPostSchema, nextPublishedAt, SLUG_TAKEN } from "@/lib/blog/post";
import { revalidateBlog } from "@/lib/blog/revalidate";
import { recordVersion, versionEvent } from "@/lib/blog/versions";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

// The admin list has no paging; past this many posts it needs it.
const MAX_POSTS_LISTED = 500;

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Every post, drafts included, newest edit first. Bodies are left out. */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  try {
    const posts = await prisma.blogPost.findMany({
      orderBy: { updatedAt: "desc" },
      take: MAX_POSTS_LISTED,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ posts });
  } catch (error) {
    console.error("[admin/blog]", error);
    return fail("Could not load posts", 500);
  }
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const parsed = createPostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }
  const data = parsed.data;

  try {
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.blogPost.create({
        data: {
          ...data,
          publishedAt: nextPublishedAt(data.status, null),
          authorId: admin.id,
        },
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          content: true,
          format: true,
          coverImageUrl: true,
          status: true,
          publishedAt: true,
        },
      });
      await recordVersion(tx, created, admin.id, versionEvent(null, created.status));
      // AdminAuditLog.merchantId holds the action's target id (no foreign
      // key); blog actions are namespaced "blog.*" and target the post.
      await auditLog(tx, admin, created.id, "blog.create", {
        slug: created.slug,
        status: created.status,
      });
      return { id: created.id, slug: created.slug, status: created.status, publishedAt: created.publishedAt };
    });
    revalidateBlog([post.slug]);
    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(SLUG_TAKEN, 409);
    }
    console.error("[admin/blog]", error);
    return fail("Could not create the post", 500);
  }
}
