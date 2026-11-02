import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

const ID = /^[a-z0-9]{20,40}$/;
type Params = { params: Promise<{ id: string; versionId: string }> };

/** One version in full, for previewing or restoring into the editor. */
export async function GET(req: NextRequest, { params }: Params) {
  const rl = await rateLimit(req);
  if (rl) return rl;
  const { response } = await requireAdmin();
  if (response) return response;

  const { id, versionId } = await params;
  if (!ID.test(id) || !ID.test(versionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const version = await prisma.blogPostVersion.findFirst({
      // Scoped to the post in the URL, so an id from another post is a 404.
      where: { id: versionId, postId: id },
      select: {
        id: true,
        createdAt: true,
        event: true,
        title: true,
        slug: true,
        excerpt: true,
        content: true,
        format: true,
        coverImageUrl: true,
        status: true,
      },
    });
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    return NextResponse.json({ version });
  } catch (error) {
    console.error("[admin/blog/:id/versions/:versionId]", error);
    return NextResponse.json({ error: "Could not load the version" }, { status: 500 });
  }
}
